# E*TRADE Israeli Tax Calculator — Chrome Extension Design

**Date:** 2026-05-12  
**Status:** Approved for implementation

---

## Context

The user holds Intel Corp (INTC) RSU grants under Israeli Section 102 **income track** (מסלול הכנסת עבודה), managed via E*TRADE. When deciding whether to sell RSU grants, there is no easy way to see how much cash they will actually receive after Israeli income tax. The E*TRADE stock plan page shows market value but has no Israeli tax awareness.

This extension injects Israeli tax calculations directly into the E*TRADE holdings table and provides a configuration popup for tax parameters.

---

## Tax Logic

### Section 102 Income Track Rules

- **At vesting:** FMV at vesting date was taxed as employment income (already withheld by trustee). The cost basis = FMV at vesting.
- **At sale — gain = (sell price − FMV at vesting) × quantity**
- **≥ 2 years post-vesting:** gain taxed at capital gains rate (default 25%)
- **< 2 years post-vesting:** gain taxed as ordinary income — either flat rate or progressive brackets

### Flat Rate Mode (user has other income this year)
- Ordinary income rate: configurable, default **47%**
- Capital gains rate: configurable, default **25%**
- Capital gains surtax: optional **+3%** toggle (Section 121b — for total income > ₪721,561/yr)
- Net = (sell price × qty) − (gain × applicable rate)

### Bracket Mode (user has NO other income this year)
- For **< 2yr grants**: apply 2026 progressive brackets to the **cumulative** total gain across all `<2yr` lots (converted to ILS), then subtract resident tax credit (₪7,986/yr). Each lot's tax = tax on (cumulative gain up to this lot) − tax on (cumulative gain before this lot). This ensures the bracket table is climbed once across all lots, not restarted per lot.
- For **≥ 2yr grants**: still use flat capital gains rate (25%) — brackets are for labor income only
- The **50% top bracket already includes the 3% surtax** (Section 121b) — no separate toggle in bracket mode
- Capital gains surtax toggle still applies to ≥ 2yr grants in bracket mode

#### 2026 Israeli Income Tax Brackets (labor income)

| Annual income (₪) | Rate |
|---|---|
| 0 – 84,120 | 10% |
| 84,121 – 120,720 | 14% |
| 120,721 – 228,000 | 20% |
| 228,001 – 301,200 | 31% |
| 301,201 – 560,280 | 35% |
| 560,281 – 721,560 | 47% |
| 721,561+ | 50% *(includes built-in 3% surtax)* |

**Resident tax credit:** ₪7,986/year (2.25 credit points) — editable in popup.

### USD/ILS Exchange Rate
- **Primary source:** Bank of Israel representative rate API (`edge.boi.org.il`) — official rate, free, no API key
- **Fallback:** `exchangerate-api.com` (free, no key)
- Fetched on extension load, cached with daily refresh
- User can manually override the displayed value; override shown with ⚠ badge
- "↻ refresh" button clears override and re-fetches

---

## UI: Inline Table Injection

The extension injects three columns into the **Sellable Holdings** table on the E*TRADE stock plan page:

| Column | Content |
|---|---|
| **IL Tax** | Tax owed on the gain from this lot |
| **Net proceeds** | Gross proceeds minus IL Tax |
| **Rate applied** | Badge: `25% CG ✓ 2yr` or `47% inc <2yr` or `~N% eff <2yr` (bracket mode) |

- Quantity is read live from the **existing E*TRADE quantity input** in each row — no duplicate inputs
- A total row is appended at the bottom showing combined IL Tax and Net across all sellable grants
- In bracket mode, a **ℹ hover tooltip** on `<2yr` rows shows the full bracket breakdown: which brackets fired, gross tax, resident credit deduction, net tax in ₪ and USD, effective rate
- Injected columns are visually distinguished with a green-tinted background

---

## UI: Configuration Popup

Accessed by clicking the extension icon in the Chrome toolbar. Settings persist via `chrome.storage.sync`.

### Controls

**Sell Price**
- Default: current market price (read from `#stockplanjson` quotes)
- Editable input — applies to all grants as a limit price override

**Income this tax year** (toggle)
- `Has income` → flat rate mode
- `No income` → bracket mode

**Tax Rates** *(flat rate mode)*
- Ordinary income rate — default 47%
- Capital gains rate — default 25%
- Surtax on CG (+3%) toggle — for income > ₪721,561/yr

**Tax Rates** *(bracket mode)*
- Capital gains rate — default 25%
- Surtax on CG (+3%) toggle — same as above
- Info box: "< 2yr grants use 2026 brackets; 50% bracket = 47% + built-in 3%"
- Resident credit (₪) — default ₪7,986, editable

**USD/ILS Rate**
- Auto-fetched, shown with source and timestamp
- Editable to override; refresh button clears override
- Always shown in bracket mode (required to convert USD gain → ₪ for bracket calculation, even when display currency is USD); also shown in flat rate mode when currency display is ILS

**Currency display**
- Toggle: USD / ILS

---

## Architecture

### Files

```
manifest.json        Chrome MV3 manifest
content.js           Page injector + tax calculator + DOM observer
popup.html           Configuration popup markup
popup.js             Popup logic, chrome.storage.sync reads/writes
popup.css            Popup styling
icons/               16px, 48px, 128px PNGs
```

### Data Flow

1. **On page load:** `content.js` parses `#stockplanjson` (hidden div E*TRADE embeds on the page) to extract:
   - Per-lot: grant ID, vesting date, FMV at vesting, available shares
   - Market price (from `quotes` section)
2. **MutationObserver** watches for the React app to render the sellable holdings table
3. Once rendered, columns are injected into each row
4. **Quantity inputs** are observed with `input` event listeners — recalculates on every keystroke
5. **Popup → content** communication via `chrome.tabs.sendMessage` — any settings change triggers a full recalculation pass
6. **Exchange rate fetch** happens in the content script (or background service worker); result stored in `chrome.storage.local` with a timestamp; refreshed if > 24hr old

### Target URL

```
https://us.etrade.com/etx/sp/stockplan*
```

### Key Implementation Notes

- The page is a React SPA; the sellable table may not exist in the DOM at `DOMContentLoaded`. Use `MutationObserver` on `#application` or `document.body` and inject once the table appears.
- The `#stockplanjson` div is present immediately in the static HTML (server-rendered), so it can be parsed synchronously.
- Injected column headers should be added to the `<thead>` row; injected cells appended to each `<tr>` in `<tbody>`.
- Store injected element references so recalculation updates cells in place (no full re-injection).
- Use `chrome.storage.sync` for user settings (syncs across devices); use `chrome.storage.local` for the cached exchange rate + timestamp.

---

## Verification

1. Load extension in Chrome (`chrome://extensions` → Load unpacked)
2. Navigate to `https://us.etrade.com/etx/sp/stockplan` → Holdings tab
3. Confirm IL Tax, Net, and Rate columns appear in the Sellable table
4. Change quantity in an existing row → verify IL Tax and Net update immediately
5. Open popup → change sell price → verify table recalculates
6. Toggle income mode → verify bracket mode shows effective rate badge and tooltip
7. Toggle ILS currency → verify amounts convert using fetched rate
8. Go offline → verify fallback exchange rate or graceful error shown
9. Verify `chrome.storage.sync` persists settings across browser restart
