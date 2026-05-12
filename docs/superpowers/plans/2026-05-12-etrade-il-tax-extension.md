# IL Tax Calculator Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that injects Israeli Section 102 income track tax columns into the E*TRADE RSU holdings table and provides a configuration popup for tax parameters.

**Architecture:** A content script parses the `#stockplanjson` hidden div for grant/lot data, uses MutationObserver to detect the React-rendered sellable table, injects IL Tax / Net Proceeds / Rate columns, and live-recalculates as the user changes quantities. A popup handles configuration. Tax logic is pure functions. Exchange rate is fetched from the Bank of Israel API and cached in `chrome.storage.local`.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS (no build tool), `chrome.storage.sync` for user settings, `chrome.storage.local` for exchange rate cache, Bank of Israel SDMX-JSON API for USD/ILS.

---

## File Map

| File | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest: permissions, content scripts, popup |
| `calculator.js` | Pure functions: `bracketTaxForAmount`, `calculateLotTax` |
| `parser.js` | Reads `#stockplanjson`, returns `{ marketPrice, lots }` |
| `injector.js` | Adds `<th>`/`<td>` IL Tax columns to the table; `updateRowCells`, `updateTotals` |
| `exchange-rate.js` | Fetches BOI rate, fallback, cache; `getExchangeRate`, `refreshExchangeRate`, `setManualExchangeRate` |
| `content.js` | Orchestrates: MutationObserver, wires all modules, recalculates on input/message |
| `popup.html` | Popup markup |
| `popup.js` | Popup logic: reads/writes `chrome.storage.sync`, sends `SETTINGS_UPDATED` messages |
| `popup.css` | Popup styling |
| `tests/test-calculator.js` | Node.js unit tests for `calculator.js` |
| `tests/test-parser.js` | Node.js unit tests for `parser.js` |

**Settings contract:** `chrome.storage.sync` stores rates as **percentages** (e.g. `47`, `25`). `popup.js` reads/writes percentages. `content.js` converts to decimals on read (`/ 100`). Messages from popup to content already carry decimals.

---

## Task 1: Scaffold — manifest, empty files, verify extension loads

**Files:** `manifest.json`, all source files (empty), `tests/`

- [ ] **Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "IL Tax Calculator for E*TRADE",
  "version": "1.0.0",
  "description": "Israeli Section 102 income track tax calculator for E*TRADE RSU holdings",
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "https://us.etrade.com/*",
    "https://edge.boi.org.il/*",
    "https://open.er-api.com/*"
  ],
  "content_scripts": [{
    "matches": ["https://us.etrade.com/etx/sp/stockplan*"],
    "js": ["calculator.js", "parser.js", "injector.js", "exchange-rate.js", "content.js"],
    "run_at": "document_idle"
  }],
  "action": {
    "default_popup": "popup.html",
    "default_title": "IL Tax Calculator"
  }
}
```

- [ ] **Step 2: Create placeholder source files**

```bash
touch calculator.js parser.js injector.js exchange-rate.js content.js
touch popup.html popup.js popup.css
mkdir -p tests && touch tests/test-calculator.js tests/test-parser.js
```

Add a single comment to each `.js` file so it parses without error. For `content.js` use:

```javascript
// content.js
console.log('[IL Tax] content script loaded');
```

- [ ] **Step 3: Create minimal popup.html**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><link rel="stylesheet" href="popup.css"></head>
<body>
  <div style="width:280px;padding:12px;font-family:monospace;background:#1a1a2e;color:#4ecca3">
    IL Tax Calculator — loading
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 4: Load extension in Chrome and verify**

1. Open `chrome://extensions`, enable Developer mode
2. Click "Load unpacked" → select `/home/nisan/chrome-rsu`
3. Confirm no errors on the extensions page
4. Navigate to `https://us.etrade.com/etx/sp/stockplan`
5. Open DevTools → Console → confirm `[IL Tax] content script loaded`

- [ ] **Step 5: Commit**

```bash
cd /home/nisan/chrome-rsu && git init && git add . && git commit -m "feat: initial Chrome extension scaffold"
```

---

## Task 2: Tax Calculator (TDD)

**Files:** `calculator.js`, `tests/test-calculator.js`

- [ ] **Step 1: Write failing tests**

`tests/test-calculator.js`:

```javascript
// Run: node tests/test-calculator.js
const fs = require('fs');
eval(fs.readFileSync('calculator.js', 'utf8'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}
function near(a, b, tol = 0.5) { return Math.abs(a - b) <= tol; }

console.log('\n--- bracketTaxForAmount ---');
assert(bracketTaxForAmount(0, IL_BRACKETS_2026) === 0, '₪0 → ₪0');
assert(near(bracketTaxForAmount(50000, IL_BRACKETS_2026), 5000), '₪50k → ₪5,000 (all 10%)');
assert(near(bracketTaxForAmount(84120, IL_BRACKETS_2026), 8412), '₪84,120 → ₪8,412 (top of 10%)');
// ₪100k: 10%×84120=8412 + 14%×15880=2223.2 = 10635.2
assert(near(bracketTaxForAmount(100000, IL_BRACKETS_2026), 10635.2), '₪100k → ₪10,635.20');
// ₪750k: spans into 50% bracket
// 10%×84120=8412 + 14%×36600=5124 + 20%×107280=21456 + 31%×73200=22692 + 35%×259080=90678 + 47%×161280=75801.6 + 50%×28440=14220 = 238383.6
assert(near(bracketTaxForAmount(750000, IL_BRACKETS_2026), 238383.6, 5), '₪750k → into 50% bracket');

console.log('\n--- calculateLotTax: capital gains (≥2yr) ---');
const cg = calculateLotTax({ gainUSD: 10000, yearsSinceVesting: 2.5, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, residentCreditILS: 7986, priorGainILS: 0 });
assert(near(cg.taxUSD, 2500), 'CG 25%, $10k → $2,500 tax');
assert(cg.mode === 'capital-gains', 'mode=capital-gains');

const cgSurtax = calculateLotTax({ gainUSD: 10000, yearsSinceVesting: 3, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: true,
  usdToILS: 3.65, residentCreditILS: 7986, priorGainILS: 0 });
assert(near(cgSurtax.taxUSD, 2800), 'CG 25%+3% surtax, $10k → $2,800');

console.log('\n--- calculateLotTax: flat ordinary (<2yr) ---');
const flat = calculateLotTax({ gainUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, residentCreditILS: 7986, priorGainILS: 0 });
assert(near(flat.taxUSD, 4700), 'Flat 47%, $10k → $4,700');
assert(flat.mode === 'flat-ordinary', 'mode=flat-ordinary');

console.log('\n--- calculateLotTax: bracket mode, first lot, no prior ---');
// $10k × 3.65 = ₪36,500 → 10% = ₪3,650 gross bracket tax
const brk1 = calculateLotTax({ gainUSD: 10000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, residentCreditILS: 7986, priorGainILS: 0 });
assert(near(brk1.grossTaxILS, 3650), 'Bracket first lot ₪36.5k → grossTaxILS ₪3,650');
assert(brk1.mode === 'bracket', 'mode=bracket');

console.log('\n--- calculateLotTax: bracket mode, second lot (priorGainILS=₪80k) ---');
// $5k × 3.65 = ₪18,250; prior = ₪80k
// taxOnTotal(₪98,250) = 10%×84120 + 14%×14130 = 8412 + 1978.2 = 10390.2
// taxOnPrior(₪80k)   = 10%×80000 = 8000
// grossTaxILS = 10390.2 - 8000 = 2390.2
const brk2 = calculateLotTax({ gainUSD: 5000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, residentCreditILS: 7986, priorGainILS: 80000 });
assert(near(brk2.grossTaxILS, 2390.2, 1), 'Bracket second lot, ₪80k prior → marginal ₪2,390');

console.log('\n--- zero gain ---');
const zero = calculateLotTax({ gainUSD: 0, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, residentCreditILS: 7986, priorGainILS: 0 });
assert(zero.taxUSD === 0, 'zero gain → zero tax');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run — verify all fail**

```bash
node tests/test-calculator.js
```

Expected: `ReferenceError: IL_BRACKETS_2026 is not defined`

- [ ] **Step 3: Implement calculator.js**

```javascript
// calculator.js

const IL_BRACKETS_2026 = [
  { limit: 84120,    rate: 0.10 },
  { limit: 120720,   rate: 0.14 },
  { limit: 228000,   rate: 0.20 },
  { limit: 301200,   rate: 0.31 },
  { limit: 560280,   rate: 0.35 },
  { limit: 721560,   rate: 0.47 },
  { limit: Infinity, rate: 0.50 }, // 47% + built-in 3% surtax (Section 121b)
];

function bracketTaxForAmount(amountILS, brackets) {
  let tax = 0;
  let prev = 0;
  for (const { limit, rate } of brackets) {
    if (amountILS <= prev) break;
    const slice = Math.min(amountILS, limit) - prev;
    tax += slice * rate;
    prev = limit;
  }
  return tax;
}

// Returns per-lot tax result.
// In bracket mode, grossTaxILS is the marginal bracket tax for this lot only.
// The resident credit is applied at the total level in the recalculation loop, not here.
function calculateLotTax({
  gainUSD,
  yearsSinceVesting,
  mode,
  flatOrdinaryRate,
  capitalGainsRate,
  capitalGainsSurtax,
  usdToILS,
  residentCreditILS, // not used here; applied at total level in bracket mode
  priorGainILS,
}) {
  if (gainUSD <= 0) {
    return { taxUSD: 0, grossTaxILS: 0, gainILS: 0, effectiveRate: 0, mode: 'zero' };
  }

  if (yearsSinceVesting >= 2) {
    const rate = capitalGainsRate + (capitalGainsSurtax ? 0.03 : 0);
    return { taxUSD: gainUSD * rate, effectiveRate: rate, mode: 'capital-gains' };
  }

  if (mode === 'flat') {
    return { taxUSD: gainUSD * flatOrdinaryRate, effectiveRate: flatOrdinaryRate, mode: 'flat-ordinary' };
  }

  // Bracket mode: marginal tax from priorGainILS to priorGainILS + gainILS
  const gainILS = gainUSD * usdToILS;
  const taxOnPrior = bracketTaxForAmount(priorGainILS, IL_BRACKETS_2026);
  const taxOnTotal = bracketTaxForAmount(priorGainILS + gainILS, IL_BRACKETS_2026);
  const grossTaxILS = taxOnTotal - taxOnPrior;
  const effectiveRate = gainILS > 0 ? grossTaxILS / gainILS : 0;
  return { taxUSD: grossTaxILS / usdToILS, grossTaxILS, gainILS, effectiveRate, mode: 'bracket' };
}
```

- [ ] **Step 4: Run — verify all pass**

```bash
node tests/test-calculator.js
```

Expected: all ✓, `0 failed`

- [ ] **Step 5: Commit**

```bash
git add calculator.js tests/test-calculator.js
git commit -m "feat: tax calculator with bracket and flat rate modes (TDD)"
```

---

## Task 3: stockplanjson Parser (TDD)

**Files:** `parser.js`, `tests/test-parser.js`

- [ ] **Step 1: Discover exact JSON field names on the live E*TRADE page**

Navigate to `https://us.etrade.com/etx/sp/stockplan` in Chrome. Open DevTools console and run:

```javascript
const data = JSON.parse(document.getElementById('stockplanjson').textContent);
console.log('Keys:', Object.keys(data));
// Find sellable holdings — look for an array of objects with vest dates and prices:
Object.entries(data).forEach(([k, v]) => {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const sub = Object.values(v)[0];
    if (Array.isArray(sub) && sub.length && sub[0].vestDate) {
      console.log('FOUND:', k, '->', Object.keys(sub[0]));
    }
  }
});
```

Note down:
- The top-level key for sellable lots (e.g. `selectedSellableHoldings`)
- The array key within it (e.g. `sellableHoldings` or `holdings`)
- Field names for: vesting date, FMV at vesting, shares available, grant ID

- [ ] **Step 2: Write failing tests using a fixture that mirrors the real structure**

`tests/test-parser.js` — fill in the real key/field names from Step 1:

```javascript
// Run: node tests/test-parser.js
const fs = require('fs');
eval(fs.readFileSync('parser.js', 'utf8'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

// FIXTURE — replace key names with what you found in Step 1
const FIXTURE = {
  quotes: {
    QuoteResponse: [{ symbol: 'INTC', lastPrice: '116.33' }]
  },
  // Replace 'selectedSellableHoldings' and 'holdings' with real keys:
  selectedSellableHoldings: {
    holdings: [
      {
        grantId: 'G001',
        vestDate: '2022-03-15',  // replace field name if different
        vestFMV: 85.20,          // replace field name if different
        sharesAvailable: 500,    // replace field name if different
        symbol: 'INTC',
      },
      {
        grantId: 'G002',
        vestDate: '2024-09-01',
        vestFMV: 22.40,
        sharesAvailable: 250,
        symbol: 'INTC',
      }
    ]
  }
};

const result = parseStockPlanJson(FIXTURE);

console.log('\n--- parseStockPlanJson ---');
assert(typeof result.marketPrice === 'number', 'marketPrice is a number');
assert(result.marketPrice === 116.33, 'marketPrice = 116.33');
assert(Array.isArray(result.lots), 'lots is an array');
assert(result.lots.length === 2, 'two lots');
assert(result.lots[0].grantId === 'G001', 'lot[0].grantId');
assert(result.lots[0].vestDate instanceof Date, 'lot[0].vestDate is Date');
assert(result.lots[0].vestDate.getFullYear() === 2022, 'lot[0] vested 2022');
assert(result.lots[0].fmvAtVesting === 85.20, 'lot[0].fmvAtVesting = 85.20');
assert(result.lots[0].sharesAvailable === 500, 'lot[0].sharesAvailable = 500');
assert(result.lots[1].vestDate.getFullYear() === 2024, 'lot[1] vested 2024');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 3: Run — verify it fails**

```bash
node tests/test-parser.js
```

Expected: `ReferenceError: parseStockPlanJson is not defined`

- [ ] **Step 4: Implement parser.js** (use real key names from Step 1)

```javascript
// parser.js

// Replace these constants with the actual key/field names from your DevTools discovery:
const SELLABLE_KEY = 'selectedSellableHoldings'; // top-level JSON key
const LOTS_ARRAY_KEY = 'holdings';               // array key within SELLABLE_KEY
const VEST_DATE_FIELD = 'vestDate';              // field name for vesting date string
const FMV_FIELD = 'vestFMV';                     // field name for FMV at vesting (number)
const SHARES_FIELD = 'sharesAvailable';          // field name for available shares (number)
const GRANT_ID_FIELD = 'grantId';               // field name for grant identifier

function parseStockPlanJson(data) {
  const quoteArr = data.quotes && data.quotes.QuoteResponse;
  const marketPrice = quoteArr && quoteArr.length > 0
    ? parseFloat(quoteArr[0].lastPrice)
    : null;

  const sellableContainer = data[SELLABLE_KEY] || {};
  const rawLots = sellableContainer[LOTS_ARRAY_KEY] || [];

  const lots = rawLots.map(lot => ({
    grantId: lot[GRANT_ID_FIELD],
    vestDate: new Date(lot[VEST_DATE_FIELD]),
    fmvAtVesting: parseFloat(lot[FMV_FIELD]),
    sharesAvailable: parseInt(lot[SHARES_FIELD], 10),
    symbol: lot.symbol || '',
  }));

  return { marketPrice, lots };
}

function parseStockPlanFromPage() {
  const el = document.getElementById('stockplanjson');
  if (!el) return null;
  try {
    return parseStockPlanJson(JSON.parse(el.textContent));
  } catch (e) {
    console.error('[IL Tax] Failed to parse stockplanjson:', e);
    return null;
  }
}
```

- [ ] **Step 5: Run — verify all pass**

```bash
node tests/test-parser.js
```

Expected: all ✓, `0 failed`

- [ ] **Step 6: Commit**

```bash
git add parser.js tests/test-parser.js
git commit -m "feat: stockplanjson parser (TDD)"
```

---

## Task 4: DOM Injector

**Files:** `injector.js`

- [ ] **Step 1: Discover the sellable table's DOM structure**

On the live E*TRADE page with DevTools open, expand `#application` in the Elements panel and find the sellable holdings table. Note:
- CSS selector for the table (e.g. `table.et-table--sellable`, look for a `<table>` inside a section labeled "Sellable")
- Selector for quantity input within each `<tr>` (e.g. `input[type="text"]`, `input.qty-input`)

Also in the console, run:
```javascript
// Find the sellable table:
document.querySelectorAll('table').forEach((t, i) => {
  console.log(i, t.className, t.closest('[class*="sell"]')?.className);
});
// Find quantity inputs:
document.querySelectorAll('input[type="text"]').forEach((inp, i) => {
  console.log(i, inp.name, inp.className, inp.closest('tr')?.textContent.slice(0, 60));
});
```

Note the selectors. You'll set `SELLABLE_TABLE_SELECTOR` and `QTY_INPUT_SELECTOR` in Step 2.

- [ ] **Step 2: Implement injector.js**

```javascript
// injector.js
// Update these selectors after Step 1 discovery:
const SELLABLE_TABLE_SELECTOR = 'table.et-table--sellable'; // <-- update
const QTY_INPUT_SELECTOR = 'input[type="text"]';            // <-- update

const IL_CLASS = 'il-tax-col';
const STYLE_HEADER = 'background:#e8f5e9;color:#1b5e20;padding:5px 8px;font-size:11px;white-space:nowrap;border-top:2px solid #4caf50;';
const STYLE_CELL   = 'background:#f1f8e9;padding:5px 8px;font-size:11px;';
const STYLE_TOTALS_ROW = 'background:#e8f5e9;font-weight:bold;';

// Injects IL Tax, Net Proceeds, Rate Applied columns into `table`.
// Returns { handles: [{ row, qtyInput, taxCell, netCell, rateCell }], totalTaxCell, totalNetCell }
// or null if already injected.
function injectColumns(table) {
  if (!table || table.dataset.ilTaxInjected) return null;
  table.dataset.ilTaxInjected = 'true';

  // Header
  const headerRow = table.querySelector('thead tr');
  if (headerRow) {
    ['IL Tax', 'Net Proceeds', 'Rate'].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      th.className = IL_CLASS;
      th.style.cssText = STYLE_HEADER;
      headerRow.appendChild(th);
    });
  }

  // Body rows
  const handles = [];
  table.querySelectorAll('tbody tr').forEach(row => {
    const qtyInput = row.querySelector(QTY_INPUT_SELECTOR);
    if (!qtyInput) return;
    const taxCell = _td(), netCell = _td(), rateCell = _td();
    taxCell.textContent = netCell.textContent = rateCell.textContent = '—';
    row.append(taxCell, netCell, rateCell);
    handles.push({ row, qtyInput, taxCell, netCell, rateCell });
  });

  // Totals row
  const existingCols = headerRow ? headerRow.querySelectorAll('th').length - 3 : 5;
  const totalsRow = document.createElement('tr');
  totalsRow.className = IL_CLASS + '-totals';
  totalsRow.style.cssText = STYLE_TOTALS_ROW;
  const spacer = document.createElement('td');
  spacer.colSpan = existingCols;
  spacer.style.cssText = 'text-align:right;padding:5px 8px;color:#555;font-size:11px;';
  spacer.textContent = 'TOTAL after IL Tax';
  const totalTaxCell = _td('background:#c8e6c9;color:#c0392b;');
  const totalNetCell = _td('background:#c8e6c9;color:#1b5e20;');
  const totalRateCell = _td('background:#c8e6c9;');
  totalsRow.append(spacer, totalTaxCell, totalNetCell, totalRateCell);
  const tbody = table.querySelector('tbody');
  if (tbody) tbody.appendChild(totalsRow);

  return { handles, totalTaxCell, totalNetCell };
}

function _td(extraStyle = '') {
  const td = document.createElement('td');
  td.className = IL_CLASS;
  td.style.cssText = STYLE_CELL + extraStyle;
  return td;
}

// Updates a single row's three injected cells.
function updateRowCells({ taxCell, netCell, rateCell }, { taxUSD, netUSD, effectiveRate, mode, currency, usdToILS }) {
  taxCell.textContent  = _fmt(taxUSD, currency, usdToILS);
  netCell.textContent  = _fmt(netUSD, currency, usdToILS);
  taxCell.style.color  = '#c0392b';
  netCell.style.color  = '#1b5e20';

  const pct = (effectiveRate * 100).toFixed(1);
  if (mode === 'capital-gains') {
    rateCell.textContent = `${pct}% CG ✓2yr`;
    rateCell.style.background = '#f1f8e9';
  } else if (mode === 'flat-ordinary') {
    rateCell.textContent = `${pct}% inc <2yr`;
    rateCell.style.background = '#fff8e1';
  } else if (mode === 'bracket') {
    rateCell.textContent = `~${pct}% eff <2yr`;
    rateCell.style.background = '#fff3e0';
  } else {
    rateCell.textContent = '—';
  }
}

function updateTotals(totalTaxCell, totalNetCell, totalTaxUSD, totalNetUSD, currency, usdToILS) {
  totalTaxCell.textContent = _fmt(totalTaxUSD, currency, usdToILS);
  totalNetCell.textContent = _fmt(totalNetUSD, currency, usdToILS);
}

function _fmt(usd, currency, usdToILS) {
  if (currency === 'ILS') {
    return '₪' + Math.round(usd * usdToILS).toLocaleString('he-IL');
  }
  return '$' + Math.round(usd).toLocaleString('en-US');
}
```

- [ ] **Step 3: Smoke test in Chrome DevTools console**

On the E*TRADE page, paste the injector.js content in the console and run:

```javascript
const table = document.querySelector('table.et-table--sellable'); // update selector
console.log('table found:', !!table);
const result = injectColumns(table);
console.log('handles:', result?.handles?.length, 'rows injected');
```

Verify:
- Three new headers appear (IL Tax, Net Proceeds, Rate) with green tint
- Each grant row gains three new cells showing `—`
- A TOTAL row appears at the bottom

Adjust `SELLABLE_TABLE_SELECTOR` and `QTY_INPUT_SELECTOR` in injector.js until this works.

- [ ] **Step 4: Commit**

```bash
git add injector.js
git commit -m "feat: DOM injector for IL Tax columns"
```

---

## Task 5: Content Script Orchestrator

**Files:** `content.js`

- [ ] **Step 1: Implement content.js**

```javascript
// content.js

// Rates stored as percentages in chrome.storage.sync; convert to decimals here.
const STORAGE_DEFAULTS = {
  sellPrice: null,
  incomeMode: 'flat',
  flatOrdinaryRate: 47,     // percent — divide by 100 before use
  capitalGainsRate: 25,     // percent — divide by 100 before use
  capitalGainsSurtax: false,
  residentCreditILS: 7986,
  usdToILS: 3.65,
  currency: 'USD',
};

// Internal settings always use decimal rates
let settings = {
  sellPrice: null,
  incomeMode: 'flat',
  flatOrdinaryRate: 0.47,
  capitalGainsRate: 0.25,
  capitalGainsSurtax: false,
  residentCreditILS: 7986,
  usdToILS: 3.65,
  currency: 'USD',
};

let injectionResult = null; // { handles, totalTaxCell, totalNetCell }
let parsedData = null;      // { marketPrice, lots }

function recalculate() {
  if (!injectionResult || !parsedData) return;
  const { handles, totalTaxCell, totalNetCell } = injectionResult;
  const sellPrice = settings.sellPrice || parsedData.marketPrice;
  const now = new Date();

  // First pass: calculate all lot taxes, tracking cumulative bracket gain
  let priorGainILS = 0;
  let totalBracketGrossILS = 0;
  const bracketHandles = [];
  let totalTaxUSD = 0;
  let totalNetUSD = 0;

  handles.forEach(({ qtyInput, taxCell, netCell, rateCell, grantId }) => {
    const qty = parseFloat(qtyInput.value) || 0;
    const lot = parsedData.lots.find(l => l.grantId === grantId);
    if (!lot || qty <= 0) {
      updateRowCells({ taxCell, netCell, rateCell },
        { taxUSD: 0, netUSD: sellPrice * qty, effectiveRate: 0, mode: 'zero',
          currency: settings.currency, usdToILS: settings.usdToILS });
      return;
    }

    const yearsSinceVesting = (now - lot.vestDate) / (365.25 * 24 * 3600 * 1000);
    const gainUSD = Math.max(0, (sellPrice - lot.fmvAtVesting) * qty);
    const grossUSD = sellPrice * qty;

    const result = calculateLotTax({
      gainUSD, yearsSinceVesting, mode: settings.incomeMode,
      flatOrdinaryRate: settings.flatOrdinaryRate,
      capitalGainsRate: settings.capitalGainsRate,
      capitalGainsSurtax: settings.capitalGainsSurtax,
      usdToILS: settings.usdToILS,
      residentCreditILS: settings.residentCreditILS,
      priorGainILS,
    });

    if (result.mode === 'bracket') {
      priorGainILS += result.gainILS || 0;
      totalBracketGrossILS += result.grossTaxILS || 0;
      bracketHandles.push({ taxCell, netCell, rateCell, gainUSD, grossUSD, result });
    } else {
      const netUSD = grossUSD - result.taxUSD;
      updateRowCells({ taxCell, netCell, rateCell },
        { taxUSD: result.taxUSD, netUSD, effectiveRate: result.effectiveRate,
          mode: result.mode, currency: settings.currency, usdToILS: settings.usdToILS });
      totalTaxUSD += result.taxUSD;
      totalNetUSD += netUSD;
    }
  });

  // Apply resident credit across all bracket lots, distribute proportionally
  if (bracketHandles.length > 0) {
    const netBracketTaxILS = Math.max(0, totalBracketGrossILS - settings.residentCreditILS);
    bracketHandles.forEach(({ taxCell, netCell, rateCell, gainUSD, grossUSD, result }) => {
      const proportion = totalBracketGrossILS > 0 ? result.grossTaxILS / totalBracketGrossILS : 0;
      const lotNetTaxILS = netBracketTaxILS * proportion;
      const lotNetTaxUSD = lotNetTaxILS / settings.usdToILS;
      const netUSD = grossUSD - lotNetTaxUSD;
      const effectiveRate = gainUSD > 0 ? lotNetTaxUSD / gainUSD : 0;
      updateRowCells({ taxCell, netCell, rateCell },
        { taxUSD: lotNetTaxUSD, netUSD, effectiveRate, mode: 'bracket',
          currency: settings.currency, usdToILS: settings.usdToILS });
      totalTaxUSD += lotNetTaxUSD;
      totalNetUSD += netUSD;
    });
  }

  updateTotals(totalTaxCell, totalNetCell, totalTaxUSD, totalNetUSD, settings.currency, settings.usdToILS);
}

function tryInject() {
  const table = document.querySelector(SELLABLE_TABLE_SELECTOR);
  if (!table || table.dataset.ilTaxInjected) return;

  parsedData = parseStockPlanFromPage();
  if (!parsedData || parsedData.lots.length === 0) return;

  injectionResult = injectColumns(table);
  if (!injectionResult) return;

  // Map grantId onto handles by position (DOM order matches lots array order)
  injectionResult.handles.forEach((handle, i) => {
    handle.grantId = parsedData.lots[i] ? parsedData.lots[i].grantId : null;
  });

  // Watch quantity inputs
  injectionResult.handles.forEach(h => h.qtyInput.addEventListener('input', recalculate));

  // Load settings from storage, convert % to decimal, fetch rate, then calculate
  chrome.storage.sync.get(STORAGE_DEFAULTS, (stored) => {
    settings = {
      ...settings,
      ...stored,
      flatOrdinaryRate: (stored.flatOrdinaryRate ?? 47) / 100,
      capitalGainsRate: (stored.capitalGainsRate ?? 25) / 100,
      sellPrice: stored.sellPrice || null,
    };
    getExchangeRate().then(rateData => {
      if (rateData) settings.usdToILS = rateData.rate;
      recalculate();
    });
  });
}

const observer = new MutationObserver(tryInject);
observer.observe(document.getElementById('application') || document.body, {
  childList: true, subtree: true,
});
tryInject();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    // Popup sends rates already as decimals
    settings = { ...settings, ...msg.settings };
    recalculate();
  }
});
```

- [ ] **Step 2: Manual test in Chrome**

Navigate to the E*TRADE stock plan page. Verify in DevTools console:
- No errors
- IL Tax / Net / Rate columns appear
- Changing a quantity input immediately updates the row and totals

If columns don't appear: check `SELLABLE_TABLE_SELECTOR` in injector.js.

If grant data isn't found: revisit parser.js Task 3 Step 1 and confirm field names.

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "feat: content script orchestrator with MutationObserver and live recalculation"
```

---

## Task 6: Exchange Rate Service

**Files:** `exchange-rate.js`

- [ ] **Step 1: Implement exchange-rate.js**

```javascript
// exchange-rate.js

const BOI_URL = 'https://edge.boi.org.il/FusionEdgesFiles/sdmx/2.1/data/DF_REPRESENTATIVE_RATE/1.0/?c[CURRENCY]=USD&lastNObservations=1&format=sdmx-json';
const FALLBACK_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_KEY = 'exchangeRateCache';
const TTL_MS = 24 * 60 * 60 * 1000;

async function _fetchBOI() {
  const res = await fetch(BOI_URL);
  if (!res.ok) throw new Error(`BOI HTTP ${res.status}`);
  const json = await res.json();
  // SDMX-JSON: dataSets[0].series["0:0:0"].observations[latestKey][0]
  const obs = json.dataSets[0].series['0:0:0'].observations;
  const key = Object.keys(obs).sort((a, b) => parseInt(a) - parseInt(b)).pop();
  const rate = parseFloat(obs[key][0]);
  if (isNaN(rate) || rate <= 0) throw new Error('BOI rate invalid');
  return rate;
}

async function _fetchFallback() {
  const res = await fetch(FALLBACK_URL);
  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
  const json = await res.json();
  const rate = parseFloat(json.rates && json.rates.ILS);
  if (isNaN(rate) || rate <= 0) throw new Error('Fallback ILS rate invalid');
  return rate;
}

async function _fetchFresh() {
  try {
    const rate = await _fetchBOI();
    console.log('[IL Tax] Exchange rate (BOI):', rate);
    return { rate, source: 'Bank of Israel', fetchedAt: Date.now(), manualOverride: false };
  } catch (e) {
    console.warn('[IL Tax] BOI failed:', e.message);
  }
  try {
    const rate = await _fetchFallback();
    console.log('[IL Tax] Exchange rate (fallback):', rate);
    return { rate, source: 'open.er-api.com', fetchedAt: Date.now(), manualOverride: false };
  } catch (e) {
    console.error('[IL Tax] Both rate sources failed:', e.message);
    return null;
  }
}

async function getExchangeRate() {
  return new Promise(resolve => {
    chrome.storage.local.get(CACHE_KEY, async (stored) => {
      const cached = stored[CACHE_KEY];
      if (cached && cached.manualOverride) { resolve(cached); return; }
      if (cached && (Date.now() - cached.fetchedAt) < TTL_MS) { resolve(cached); return; }
      const fresh = await _fetchFresh();
      if (fresh) chrome.storage.local.set({ [CACHE_KEY]: fresh });
      resolve(fresh || cached || { rate: 3.65, source: 'default', fetchedAt: 0, manualOverride: false });
    });
  });
}

async function refreshExchangeRate() {
  const fresh = await _fetchFresh();
  if (fresh) chrome.storage.local.set({ [CACHE_KEY]: fresh });
  return fresh;
}

function setManualExchangeRate(rate) {
  const entry = { rate, source: 'manual', fetchedAt: Date.now(), manualOverride: true };
  chrome.storage.local.set({ [CACHE_KEY]: entry });
  return entry;
}
```

- [ ] **Step 2: Test exchange rate fetch in Chrome DevTools**

On any E*TRADE page (where the extension is active), open DevTools console and run:

```javascript
getExchangeRate().then(r => console.log('Rate:', r));
```

Expected: `{ rate: 3.65..., source: "Bank of Israel", fetchedAt: ..., manualOverride: false }`

If BOI fails (CORS or network), expect fallback to trigger. If both fail, expect `rate: 3.65` default.

- [ ] **Step 3: Commit**

```bash
git add exchange-rate.js
git commit -m "feat: exchange rate service (BOI primary, fallback, chrome.storage.local cache)"
```

---

## Task 7: Popup UI

**Files:** `popup.html`, `popup.css`, `popup.js`

- [ ] **Step 1: Implement popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="header">🧮 IL Tax Calculator</div>

  <div class="field">
    <label>Sell Price (USD)</label>
    <input id="sellPrice" type="number" step="0.01" placeholder="Market price (auto)" />
  </div>

  <div class="field">
    <label>Income this tax year</label>
    <div class="toggle-group">
      <button class="toggle-btn" id="modeFlat">Has income</button>
      <button class="toggle-btn" id="modeBracket">No income (brackets)</button>
    </div>
  </div>

  <div id="flatSection">
    <div class="field">
      <label>Ordinary income rate <span class="hint">(&lt;2yr post-vest)</span></label>
      <div class="input-pct"><input id="flatOrdinaryRate" type="number" step="0.1" min="0" max="100" /><span>%</span></div>
    </div>
  </div>

  <div class="field">
    <label>Capital gains rate <span class="hint">(≥2yr post-vest)</span></label>
    <div class="input-pct"><input id="capitalGainsRate" type="number" step="0.1" min="0" max="100" /><span>%</span></div>
  </div>

  <div class="field checkbox-field">
    <label><input id="capitalGainsSurtax" type="checkbox" /> Surtax on CG +3% <span class="hint">(income &gt;₪721,561)</span></label>
  </div>

  <div id="bracketSection" class="hidden">
    <div class="bracket-info">
      📊 &lt;2yr grants: 2026 brackets applied<br>
      10%→14%→20%→31%→35%→47%→<strong>50%</strong><br>
      <small>50% = 47% + built-in 3% surtax (§121b)</small>
    </div>
    <div class="field">
      <label>Resident tax credit (₪)</label>
      <input id="residentCreditILS" type="number" step="1" />
    </div>
  </div>

  <div class="field" id="rateRow">
    <label>USD / ILS</label>
    <div class="rate-row">
      <input id="usdToILS" type="number" step="0.0001" min="0.1" />
      <button id="refreshRate" title="Re-fetch from Bank of Israel">↻</button>
    </div>
    <span id="rateSource" class="hint"></span>
  </div>

  <div class="field">
    <label>Display currency</label>
    <div class="toggle-group">
      <button class="toggle-btn" id="currUSD">USD</button>
      <button class="toggle-btn" id="currILS">ILS</button>
    </div>
  </div>

  <script src="exchange-rate.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement popup.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  width: 290px; padding: 14px;
  font-family: 'Courier New', monospace; font-size: 12px;
  background: #1a1a2e; color: #e0e0e0;
}
.header { color: #4ecca3; font-weight: bold; font-size: 14px; margin-bottom: 14px; }
.field { margin-bottom: 11px; }
label { display: block; color: #aaa; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
.hint { color: #555; font-size: 9px; text-transform: none; letter-spacing: 0; }
input[type="number"] {
  background: #16213e; border: 1px solid #0f3460; border-radius: 4px;
  color: #e0e0e0; padding: 4px 8px; font-size: 12px; font-family: inherit; width: 100%;
}
input[type="number"]:focus { outline: none; border-color: #4ecca3; }
input[type="checkbox"] { margin-right: 6px; }
.input-pct { display: flex; align-items: center; gap: 4px; }
.input-pct input { flex: 1; }
.input-pct span { color: #aaa; }
.toggle-group { display: flex; gap: 4px; }
.toggle-btn {
  background: #16213e; border: 1px solid #0f3460; border-radius: 4px;
  color: #555; padding: 4px 10px; font-size: 10px; font-family: inherit; cursor: pointer;
}
.toggle-btn.active { background: #0f3460; color: #4ecca3; border-color: #4ecca3; }
.bracket-info {
  background: #0d2a1a; border: 1px solid #1a5a30; border-radius: 5px;
  padding: 8px; color: #4ecca3; font-size: 10px; line-height: 1.6; margin-bottom: 10px;
}
.rate-row { display: flex; gap: 6px; align-items: center; }
.rate-row input { flex: 1; }
#refreshRate {
  background: #0f3460; border: none; border-radius: 4px;
  color: #aaa; padding: 4px 8px; cursor: pointer; font-size: 13px;
}
#refreshRate:hover { color: #4ecca3; }
.hidden { display: none; }
```

- [ ] **Step 3: Implement popup.js**

```javascript
// popup.js
// Rates in chrome.storage.sync are percentages (47, 25).
// They are divided by 100 before being sent to the content script.

const DEFAULTS = {
  sellPrice: null, incomeMode: 'flat',
  flatOrdinaryRate: 47, capitalGainsRate: 25,
  capitalGainsSurtax: false, residentCreditILS: 7986,
  usdToILS: 3.65, currency: 'USD',
};

function _sendToContent(patch) {
  chrome.storage.sync.get(DEFAULTS, (current) => {
    const merged = { ...current, ...patch };
    chrome.storage.sync.set(merged, () => {
      const msg = {
        type: 'SETTINGS_UPDATED',
        settings: {
          ...merged,
          flatOrdinaryRate: merged.flatOrdinaryRate / 100,
          capitalGainsRate: merged.capitalGainsRate / 100,
          sellPrice: merged.sellPrice ? parseFloat(merged.sellPrice) : null,
        },
      };
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg);
      });
    });
  });
}

function _setMode(mode) {
  document.getElementById('modeFlat').classList.toggle('active', mode === 'flat');
  document.getElementById('modeBracket').classList.toggle('active', mode === 'bracket');
  document.getElementById('flatSection').classList.toggle('hidden', mode !== 'flat');
  document.getElementById('bracketSection').classList.toggle('hidden', mode !== 'bracket');
  document.getElementById('rateRow').classList.toggle('hidden',
    mode === 'flat' && document.getElementById('currUSD').classList.contains('active'));
}

function _setCurrency(currency) {
  document.getElementById('currUSD').classList.toggle('active', currency === 'USD');
  document.getElementById('currILS').classList.toggle('active', currency === 'ILS');
  const isFlat = document.getElementById('modeFlat').classList.contains('active');
  document.getElementById('rateRow').classList.toggle('hidden', isFlat && currency === 'USD');
}

function _rateLabel(rateData) {
  if (!rateData) return 'Rate unavailable';
  const d = new Date(rateData.fetchedAt).toLocaleDateString('en-IL');
  return `${rateData.source} · ${d}${rateData.manualOverride ? ' ⚠ override' : ''}`;
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(DEFAULTS, (s) => {
    document.getElementById('sellPrice').value          = s.sellPrice || '';
    document.getElementById('flatOrdinaryRate').value   = s.flatOrdinaryRate;
    document.getElementById('capitalGainsRate').value   = s.capitalGainsRate;
    document.getElementById('capitalGainsSurtax').checked = s.capitalGainsSurtax;
    document.getElementById('residentCreditILS').value  = s.residentCreditILS;
    document.getElementById('usdToILS').value           = s.usdToILS;
    _setMode(s.incomeMode);
    _setCurrency(s.currency);
  });

  chrome.storage.local.get('exchangeRateCache', (stored) => {
    const c = stored.exchangeRateCache;
    if (c) {
      document.getElementById('usdToILS').value = c.rate;
      document.getElementById('rateSource').textContent = _rateLabel(c);
    } else {
      document.getElementById('rateSource').textContent = 'Fetching…';
      getExchangeRate().then(r => {
        if (r) {
          document.getElementById('usdToILS').value = r.rate;
          document.getElementById('rateSource').textContent = _rateLabel(r);
          _sendToContent({ usdToILS: r.rate });
        }
      });
    }
  });

  document.getElementById('modeFlat').addEventListener('click', () => {
    _setMode('flat'); _sendToContent({ incomeMode: 'flat' });
  });
  document.getElementById('modeBracket').addEventListener('click', () => {
    _setMode('bracket'); _sendToContent({ incomeMode: 'bracket' });
  });
  document.getElementById('currUSD').addEventListener('click', () => {
    _setCurrency('USD'); _sendToContent({ currency: 'USD' });
  });
  document.getElementById('currILS').addEventListener('click', () => {
    _setCurrency('ILS'); _sendToContent({ currency: 'ILS' });
  });
  document.getElementById('sellPrice').addEventListener('input', e => {
    _sendToContent({ sellPrice: e.target.value ? parseFloat(e.target.value) : null });
  });
  document.getElementById('flatOrdinaryRate').addEventListener('input', e => {
    _sendToContent({ flatOrdinaryRate: parseFloat(e.target.value) || 0 });
  });
  document.getElementById('capitalGainsRate').addEventListener('input', e => {
    _sendToContent({ capitalGainsRate: parseFloat(e.target.value) || 0 });
  });
  document.getElementById('capitalGainsSurtax').addEventListener('change', e => {
    _sendToContent({ capitalGainsSurtax: e.target.checked });
  });
  document.getElementById('residentCreditILS').addEventListener('input', e => {
    _sendToContent({ residentCreditILS: parseFloat(e.target.value) || 0 });
  });
  document.getElementById('usdToILS').addEventListener('input', e => {
    const rate = parseFloat(e.target.value);
    if (!isNaN(rate) && rate > 0) {
      setManualExchangeRate(rate);
      document.getElementById('rateSource').textContent = _rateLabel(
        { source: 'manual', fetchedAt: Date.now(), manualOverride: true }
      );
      _sendToContent({ usdToILS: rate });
    }
  });
  document.getElementById('refreshRate').addEventListener('click', async () => {
    document.getElementById('rateSource').textContent = 'Fetching…';
    const fresh = await refreshExchangeRate();
    if (fresh) {
      document.getElementById('usdToILS').value = fresh.rate;
      document.getElementById('rateSource').textContent = _rateLabel(fresh);
      _sendToContent({ usdToILS: fresh.rate });
    } else {
      document.getElementById('rateSource').textContent = 'Fetch failed — using cached';
    }
  });
});
```

- [ ] **Step 4: Manual test popup**

Click the extension icon. Verify:
- All controls render correctly
- Toggling "No income (brackets)" hides the ordinary income rate field and shows bracket info + resident credit
- Exchange rate shows source label with date
- Currency toggle works, USD/ILS rate row hides in flat+USD mode

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: popup configuration UI (all controls, exchange rate, mode toggle)"
```

---

## Task 8: End-to-End Verification

- [ ] **Step 1: Reload extension and navigate**

```
chrome://extensions → click ↺ on IL Tax Calculator
Navigate to https://us.etrade.com/etx/sp/stockplan?accountIndex=0&traxui=tsp_portfolios/#/holdings
```

DevTools console: no errors.

- [ ] **Step 2: Verify column injection**

IL Tax, Net Proceeds, Rate columns appear with green header tint. Grant rows show dollar values (not `—`). TOTAL row at bottom shows combined figures.

- [ ] **Step 3: Verify live quantity update**

Change the quantity in a grant row → IL Tax and Net Proceeds update immediately without page reload. TOTAL row updates.

- [ ] **Step 4: Verify sell price override**

Open popup → enter `120.00` in Sell Price → table recalculates using $120.00.
Clear sell price → table reverts to market price.

- [ ] **Step 5: Verify bracket mode**

Open popup → click "No income (brackets)".
For < 2yr grants: Rate shows `~N% eff <2yr` — effective rate should be noticeably lower than 47% for typical RSU gains.
For ≥ 2yr grants: Rate still shows `N% CG ✓2yr`.

- [ ] **Step 6: Verify ILS currency**

Open popup → click ILS → table amounts switch to ₪, using the fetched exchange rate.

- [ ] **Step 7: Verify exchange rate flow**

In bracket mode popup: source label shows "Bank of Israel · today's date".
Edit the rate manually → label shows "⚠ override".
Click ↻ → label reverts to "Bank of Israel · today's date", override cleared.

- [ ] **Step 8: Verify persistence across reload**

Set sell price $110, mode bracket, currency ILS. Close browser tab, reopen E*TRADE page → settings restored and table uses them.

- [ ] **Final commit**

```bash
git add .
git commit -m "feat: complete IL Tax Calculator Chrome extension v1.0"
```
