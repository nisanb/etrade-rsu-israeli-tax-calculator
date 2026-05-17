// Run: node tests/test-qty-poller.js
'use strict';

const h = require('./_harness');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
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
function mdyStr(d) { return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; }

const now      = new Date();
const grantOld = new Date(now.getFullYear() - 3, 0, 1);
const vestOld  = new Date(now.getFullYear() - 1, 0, 15);

function silentFetch() {
  return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
}

// Track how many times recalculate() runs by wrapping the IL Tax cell update.
// Since recalculate writes to taxCell.textContent / innerHTML, we can observe
// cell state changes as a proxy for recalculate having run.
function getTaxCellText(doc) {
  const rows = Array.from(doc.querySelectorAll('tbody tr')).filter(r => r.querySelector('input'));
  if (!rows.length) return '';
  const cells = Array.from(rows[0].querySelectorAll('td'));
  return cells[7] ? cells[7].textContent.trim() : '';
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- editQty with input event triggers immediate recalculate ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 0 }],
  });
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  const input = row.querySelector('input');

  // Before: tax cell shows '—'
  const before = getTaxCellText(doc);
  assert(before === '—', 'input event: tax cell initially shows "—"');

  // Set proceeds and fire input event
  proceedsTd.textContent = '$8,520';
  h.editQty(input, 100);

  const after = getTaxCellText(doc);
  assert(after !== '—' && after !== '', 'input event: tax cell updated immediately after input event');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Programmatic value change (no event) NOT detected before tick ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 0 }],
  });
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  const input = row.querySelector('input');

  const before = getTaxCellText(doc);
  assert(before === '—', 'Select-All: tax cell initially shows "—"');

  // Simulate E*TRADE's "Select All" button: sets value without firing events.
  proceedsTd.textContent = '$8,520';
  h.selectAll([input], 100);

  // No tick yet — recalculate has NOT been triggered by the poller.
  const midway = getTaxCellText(doc);
  assert(midway === '—', 'Select-All: tax cell still "—" before poller tick');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Programmatic value change detected by poller after tick(200) ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 0 }],
  });
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  const input = row.querySelector('input');

  // Set proceeds and qty silently (no event).
  proceedsTd.textContent = '$8,520';
  h.selectAll([input], 100);

  assert(getTaxCellText(doc) === '—', 'poller: tax cell "—" before tick');

  // Tick 200ms → the 150ms interval fires at least once.
  h.tick(200);

  const afterTick = getTaxCellText(doc);
  assert(afterTick !== '—' && afterTick !== '', 'poller: tax cell updated after tick(200)');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Poller only fires recalculate when value actually changes ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 50 }],
  });
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  const input = row.querySelector('input');

  // Set initial state via event so recalculate runs once.
  proceedsTd.textContent = '$4,260';
  input.value = '50';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  const firstResult = getTaxCellText(doc);

  // Tick once without changing value — poller should detect no change and NOT recalculate.
  // Recalculate would produce the same result anyway, but we verify the stable-value path.
  h.tick(200);
  const afterNoChange = getTaxCellText(doc);
  assert(afterNoChange === firstResult, 'poller stability: tax cell unchanged when value did not change');

  // Now change value silently.
  proceedsTd.textContent = '$8,520';
  h.selectAll([input], 100);
  h.tick(200);
  const afterChange = getTaxCellText(doc);
  assert(afterChange !== firstResult && afterChange !== '—',
         'poller stability: tax cell updates after silent value change followed by tick');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Race: input event fires before proceeds td updates (deferred recovery) ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // Simulates real E*TRADE behavior: when the user types in the qty input, the native
  // `input` event fires synchronously, but E*TRADE only updates the proceeds td a moment
  // later (async via React). The first recalculate() therefore sees the new qty but stale
  // $0 proceeds and writes mode='zero'. The poller must recover this on a later tick when
  // the proceeds td gets its updated value.
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 0 }],
  });
  h.mockFetch(silentFetch);
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  const input = row.querySelector('input');

  assert(getTaxCellText(doc) === '—', 'race: tax cell initially "—"');

  // Step 1: user types "3" — fire input event WITHOUT updating proceeds td yet.
  // The synchronous recalculate sees qty=3 but proceeds still "$0.00" → mode='zero'.
  input.value = '3';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert(getTaxCellText(doc) === '—',
         'race: after input event with stale proceeds, tax cell stays "—" (the bug we are guarding against)');

  // Step 2: E*TRADE updates the proceeds td asynchronously (no event fires here).
  proceedsTd.textContent = '$256';

  // Step 3: poller ticks. Even though qty did not change, the proceeds td text did.
  // The poller must detect that and re-run recalculate.
  h.tick(200);

  const afterRecovery = getTaxCellText(doc);
  assert(afterRecovery !== '—' && afterRecovery !== '',
         'race: poller recovers by re-running recalculate when proceeds td text changes');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
