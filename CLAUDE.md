# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run tests** (no install needed — plain Node.js, run from repo root):
```bash
node tests/test-calculator.js
node tests/test-parser.js
node tests/test-package-extension.js
```

**Run a single test file:**
```bash
node tests/test-calculator.js
```

**Package the extension:**
```bash
python3 scripts/package_extension.py --source . --output dist/il-tax-calculator-etrade.zip
```

No build step. Edit JS/CSS directly, then reload the extension at `chrome://extensions`.

## Architecture

**No bundler, no framework.** All files are loaded directly by the browser or Node.js `eval()` in tests. Scripts share a single global scope within the extension's content script context.

### Content script pipeline (load order matters)

Scripts are injected in this order by `manifest.json`:

1. **`calculator.js`** — pure tax math, no DOM or Chrome APIs. Exports globals: `calculateLotTax()`, `bracketTaxForAmount()`, `IL_BRACKETS_2026`.
2. **`parser.js`** — reads `window.__stockplanjson__` (E*TRADE embeds lot data as a stringified JSON in a hidden `<div id="stockplanjson">` or `__stockplanjson__` global). Exports `parseStockPlanFromPage()` → `{ grantDateMap, marketPrice }`.
3. **`injector.js`** — injects extra columns into the E*TRADE table and manages per-row DOM handles. Exports `injectColumns()` → `{ handles[], totalTaxCell, totalNetCell, totalSplitCell }`, plus `updateRowCells()` and `updateTotals()`.
4. **`exchange-rate.js`** — fetches USD/ILS from Bank of Israel (`edge.boi.org.il`) with a local `chrome.storage.local` cache. Exports `getExchangeRate()`, `refreshExchangeRate()`, `setManualExchangeRate()`.
5. **`content.js`** — orchestrator. Calls the above in sequence: finds table → parses → injects → polls qty inputs every 150ms → recalculates on each change.

### The critical `grantDateMap`

`parser.js` builds a `Map<string, Date[]>` where the key is `vestDate.getTime().toString()` and the value is an **ordered array** of grant dates — one per grant that vests on that date, in the same order as table rows.

`content.js` uses `vestDateCounters: Map` to track how many rows for a given vest date have been processed, then picks `grantDateMap.get(key)[vestIdx]`. This handles the case where multiple grants vest on the same calendar day.

The 2yr clock runs from **grant date**, not vest date (Israeli Section 102 income track). A vest from a grant >2yr old → 25% capital gains on appreciation. A vest <2yr from grant → ordinary income rate on entire proceeds.

### Settings flow

- **Popup** (`popup.html/css/js`) stores rates as **percentages** (e.g. `47`) in `chrome.storage.sync`.
- **Content script** receives rates as **decimals** (divided by 100 before sending) via `chrome.runtime.sendMessage` with type `SETTINGS_UPDATED`.
- The `STORAGE_DEFAULTS` constant in `content.js` must stay in sync with `DEFAULTS` in `popup.js`.

### React DOM gotcha

E*TRADE is a React SPA. The table can re-render at any time, replacing DOM nodes. To avoid stale data:
- **Vest date and FMV** are read from `cells[1]` and `cells[3]` on every `recalculate()` call, not captured at injection time.
- The qty input (`input.form-control[placeholder="0"]`) is re-queried each call via `row.querySelector()`.
- A 150ms `setInterval` poller (`_startQtyPoller`) catches programmatic qty changes that don't fire DOM events (e.g. E*TRADE's "Select All" button uses React's synthetic event system, not native events).

### CI / publishing

Every push to `master` triggers `.github/workflows/chrome-web-store.yml`:
1. Runs all three test files (must pass)
2. Packages extension as a versioned `.zip` via `scripts/package_extension.py`
3. Publishes to Chrome Web Store via `npx chrome-webstore-upload-cli` using secrets stored in GitHub Actions (`CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN`, `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`)

Version is read from `manifest.json` — bump it there before pushing.

## Workflow: Issues → PR → Merge

When addressing GitHub issues:
1. **Open a PR** (do not commit directly to `master` for feature/fix work)
2. Link issues in the PR body with `Closes #N` so they auto-close on merge
3. Add a description of what changed and why — not just a list of files
4. After merging, add a comment to each issue summarising what was implemented

Example PR body:
```
Closes #2, #3, #4

## What changed
- background.js: opens welcome.html on first install only
- popup: added "Go to E*TRADE Holdings" CTA button
- injector: IL Tax cells now show superscript ⓘ icon

## Why
...
```

## Tax rules reference

**≥ 2 years from grant date (Section 102 income track):**
- Ordinary income tax = `rate × min(grossProceeds, FMV × qty)`
- Capital gains tax = `25% × max(0, grossProceeds − FMV × qty)`

**< 2 years from grant date:**
- Total tax = `ordinaryRate × entireGrossProceeds`

Bracket mode applies `IL_BRACKETS_2026` (in `calculator.js`) to the ordinary income portion, then the annual resident tax credit is subtracted proportionally across lots in `content.js`.
