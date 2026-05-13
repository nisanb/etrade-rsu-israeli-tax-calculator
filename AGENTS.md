# AGENTS.md — AI Agent Guidelines

This file describes the codebase for AI coding agents (Claude Code, Copilot, etc.).

## What this project is

A Chrome Extension (Manifest V3) that injects Israeli Section 102 income-track tax estimates
into the E*TRADE stock-plan holdings page. No framework, no build step, pure vanilla JS.

## File map

| File | Responsibility |
|---|---|
| `manifest.json` | Extension manifest: permissions, content script list, popup |
| `calculator.js` | Pure tax-math functions. No DOM, no side effects. |
| `parser.js` | Parses `stockplanjson` embedded in E*TRADE page. Extracts lots + grant dates. |
| `injector.js` | Injects columns into the E*TRADE table. Owns the popup modal. No tax math. |
| `exchange-rate.js` | Fetches USD/ILS from Bank of Israel (BOI) API. Caches to `chrome.storage.local`. |
| `content.js` | Orchestrates everything: finds table, wires parser → injector → calculator. |
| `popup.html/css/js` | Extension popup UI. Reads/writes `chrome.storage.sync`. |
| `tests/` | Node.js test files for `calculator.js` and `parser.js`. |

## Architecture rules

- **calculator.js is pure.** Never add DOM access or `chrome.*` calls there.
- **injector.js owns the DOM.** Tax numbers flow in from content.js; injector renders them.
- **content.js is the only file that wires things together.** It holds `settings`, calls
  `parseStockPlanFromPage()`, `injectColumns()`, and `recalculate()`.
- **No bundler.** Files are listed in `manifest.json` `content_scripts.js` array in load order.
  New files must be added there.

## Key invariants

- `recalculate()` reads `dateText` and `fmvText` **dynamically** from `row.querySelectorAll('td')`
  every time — never from injection-time snapshots. React re-renders rows with different data.
- The 2-year Section 102 clock starts from **grant date** (from `stockplanjson`), not vest date.
  `parsedData.grantDateMap` is keyed by `vestDate.getTime() + '_' + Math.round(fmvAtVesting * 100)`.
- Qty inputs are polled every 150 ms because E*TRADE's React overrides the DOM `input` event
  for programmatic updates (e.g. the "Select" button). Do not replace polling with event listeners.
- The popup (`injector.js`) stores calculation data as JSON in `taxCell.dataset.ilTipData`.
  Do not change the shape of this object without updating `_renderAndShowPopup` and `_popupCopyText`.

## Tax law (Section 102 income track)

```
≥ 2 years from grant date:
  ordinary_income_tax = rate × min(gross, FMV × qty)
  capital_gains_tax   = 25% × max(0, gross − FMV × qty)

< 2 years from grant date:
  total_tax = ordinary_rate × gross_proceeds
```

Bracket mode applies 2026 Israeli marginal brackets (`IL_BRACKETS_2026` in `calculator.js`)
to ordinary income, then subtracts the annual resident credit at the aggregate level
(not per lot).

## Storage schema

`chrome.storage.sync` keys (stored as percentages for rates):
```
incomeMode: 'flat' | 'bracket'
flatOrdinaryRate: number   (e.g. 47 for 47%)
capitalGainsRate: number   (e.g. 25 for 25%)
capitalGainsSurtax: boolean
residentCreditILS: number  (e.g. 7986)
usdToILS: number           (e.g. 3.65)
currency: 'USD' | 'ILS'
```

`chrome.storage.local` key:
```
exchangeRateCache: { rate, source, fetchedAt, manualOverride }
```

## Testing

```bash
node tests/calculator.test.js   # tax math unit tests
node tests/parser.test.js       # JSON parsing unit tests
```

No browser environment needed — tests use plain Node.js.
