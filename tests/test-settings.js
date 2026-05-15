// Run: node tests/test-settings.js
'use strict';

const h = require('./_harness');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}
function near(a, b, tol = 0.5) { return Math.abs(a - b) <= tol; }

// Suppress async fetch noise — all settings tests exercise sync paths.
function silentFetch() {
  return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
}

// Build E*TRADE stockplanjson shape
function makeStockplanJson(grantList) {
  return {
    selectedAccountHoldings: {
      SPPlanTabDisplay: {
        lastSalePrice: 110,
        rs: {
          list: grantList.map(g => ({
            grantDate: g.grantDate,
            childList: [{ rsReleaseDate: g.vestDateRaw, purchaseDateFMV: g.fmv, sellableShares: g.shares }],
          })),
        },
      },
    },
  };
}

function dmyStr(d) {
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()}`;
}
function mdyStr(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const now     = new Date();
const grantOld = new Date(now.getFullYear() - 3, 0, 1); // >2yr
const vestOld  = new Date(now.getFullYear() - 1, 0, 15);
const grantNew = new Date(now.getFullYear(), 0, 1);     // <1yr
const vestNew  = new Date(now.getFullYear(), 0, 15);

// Helper: set up, load scripts, set qty + proceeds, fire input event; return taxCell text.
function recalcWithSettings(syncSettings, grossUSD, qty, fmv, grantDate, vestDate) {
  // Pre-populate syncStore before loading scripts so storage.sync.get returns them.
  // We do this by calling setupDOM, then manually setting into the store.
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantDate), vestDateRaw: dmyStr(vestDate), fmv, shares: qty },
    ]),
    rows: [{ vestDate: mdyStr(vestDate), fmv, qty: 0 }],
  });
  // Pre-seed sync storage with test settings (overrides STORAGE_DEFAULTS).
  // getSyncStore() won't work before loadContentScripts; we reach into the internal store
  // via a zero-item read then set. Use chrome mock directly via emitMessage post-load.
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();

  // Push settings via SETTINGS_UPDATED message (the way popup.js does it).
  h.emitMessage({ type: 'SETTINGS_UPDATED', settings: syncSettings });

  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  proceedsTd.textContent = '$' + grossUSD.toLocaleString('en-US');
  const input = row.querySelector('input');
  input.value = String(qty);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  return cells[7]; // IL Tax cell
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Default settings load (flat mode, 47%) ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 100.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestNew), fmv: 100.00, qty: 0 }],
  });
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  // grossUSD=$11,000 (100 × $110); flat <2yr: tax = $11,000 × 0.47 = $5,170
  proceedsTd.textContent = '$11,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  const rateCell = cells[9]; // Rate column (Status=6, IL Tax=7, Net=8, Rate=9)
  assert(rateCell && rateCell.textContent.includes('47'), 'defaults: rate cell shows 47% in flat mode');
  assert(rateCell && rateCell.textContent.includes('<2yr'), 'defaults: rate cell shows <2yr indicator');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- SETTINGS_UPDATED changes ordinary rate ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  const taxCell = recalcWithSettings(
    { incomeMode: 'flat', flatOrdinaryRate: 0.30, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 7986, ytdTaxableIncomeILS: 0 },
    10000, // grossUSD
    100,   // qty
    100,   // fmv at vest
    grantNew, vestNew
  );
  // grossUSD=$10,000 <2yr flat 30% → tax = $3,000
  const tipData = taxCell && taxCell.dataset.ilTipData;
  assert(!!tipData, 'SETTINGS_UPDATED: ilTipData present');
  if (tipData) {
    const d = JSON.parse(tipData);
    assert(near(d.taxUSD, 3000, 1), 'SETTINGS_UPDATED: taxUSD reflects new 30% rate');
    assert(near(d.ordinaryRate, 0.30, 0.001), 'SETTINGS_UPDATED: ordinaryRate in tip data is 0.30');
  }
  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- SETTINGS_UPDATED: switch to capital gains (≥2yr) ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  const taxCell = recalcWithSettings(
    { incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 7986, ytdTaxableIncomeILS: 0 },
    10000, 100, 85.20, grantOld, vestOld
  );
  // grossUSD=$10,000; benefitUSD=100×$85.20=$8,520; CG=($10,000-$8,520)×0.25=$370
  // ordinary=$8,520×0.47=$4,004.40; total≈$4,374
  const tipData = taxCell && taxCell.dataset.ilTipData;
  if (tipData) {
    const d = JSON.parse(tipData);
    assert(d.mode === 'capital-gains', 'SETTINGS_UPDATED: ≥2yr lot uses capital-gains mode');
    assert(near(d.cgTaxUSD, 370, 2), 'SETTINGS_UPDATED: cgTaxUSD ≈ $370 (25% on $1,480 appreciation)');
  } else {
    assert(false, 'SETTINGS_UPDATED: ≥2yr lot — ilTipData missing');
  }
  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- SETTINGS_UPDATED: §121b surtax toggle ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // Without surtax: flat <2yr $10k × 47% = $4,700
  const taxCellOff = recalcWithSettings(
    { incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 7986, ytdTaxableIncomeILS: 0 },
    10000, 100, 100, grantNew, vestNew
  );
  const offData = taxCellOff && taxCellOff.dataset.ilTipData;
  h.teardown();

  // With surtax: flat <2yr $10k × 50% = $5,000
  const taxCellOn = recalcWithSettings(
    { incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: true, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 7986, ytdTaxableIncomeILS: 0 },
    10000, 100, 100, grantNew, vestNew
  );
  const onData = taxCellOn && taxCellOn.dataset.ilTipData;
  h.teardown();

  if (offData && onData) {
    const off = JSON.parse(offData);
    const on  = JSON.parse(onData);
    assert(near(off.taxUSD, 4700, 1), 'surtax toggle: off → tax = $4,700');
    assert(near(on.taxUSD, 5000, 1),  'surtax toggle: on  → tax = $5,000');
  } else {
    assert(false, 'surtax toggle: missing ilTipData');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Bracket mode: ytdTaxableIncomeILS shifts marginal rate ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // Two recalcs: same lot, bracket mode, different ytdTaxableIncomeILS.
  // priorGainILS=0: $10k × 3.65 = ₪36,500 → 10% bracket → grossTaxILS ≈ ₪3,650 → taxUSD ≈ $1,000
  const taxCellLowYtd = recalcWithSettings(
    { incomeMode: 'bracket', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 0 },
    10000, 100, 100, grantNew, vestNew
  );
  const lowData = taxCellLowYtd && taxCellLowYtd.dataset.ilTipData;
  h.teardown();

  // priorGainILS=500,000: lot lands at 35% marginal → grossTaxILS ≈ ₪12,775 → taxUSD ≈ $3,499
  const taxCellHighYtd = recalcWithSettings(
    { incomeMode: 'bracket', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 500000 },
    10000, 100, 100, grantNew, vestNew
  );
  const highData = taxCellHighYtd && taxCellHighYtd.dataset.ilTipData;
  h.teardown();

  if (lowData && highData) {
    const low  = JSON.parse(lowData);
    const high = JSON.parse(highData);
    assert(high.taxUSD > low.taxUSD,
           'bracket YTD: high ytdTaxableIncomeILS → higher taxUSD');
    assert(near(low.taxUSD, 1000, 50),
           'bracket YTD: zero prior income → taxUSD ≈ $1,000 (10% bracket)');
    assert(near(high.taxUSD, 3499, 100),
           'bracket YTD: prior=500k → taxUSD ≈ $3,499 (35% bracket)');
  } else {
    assert(false, 'bracket YTD: missing ilTipData');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Currency toggle: ILS display ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 100.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestNew), fmv: 100.00, qty: 0 }],
  });
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();

  h.emitMessage({
    type: 'SETTINGS_UPDATED',
    settings: { incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
                capitalGainsSurtax: false, usdToILS: 3.65, currency: 'ILS',
                residentCreditILS: 7986, ytdTaxableIncomeILS: 0 },
  });

  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  proceedsTd.textContent = '$10,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  const netCell = cells[8];
  // Net proceeds in ILS: ($10,000 - $4,700) × 3.65 = $5,300 × 3.65 = ₪19,345
  assert(netCell && netCell.textContent.includes('₪'),
         'currency ILS: net proceeds cell shows ₪ symbol');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
