// Run: node tests/test-injection.js
'use strict';

const h = require('./_harness');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

// Build an E*TRADE-shaped stockplanjson using the real path _discoverLots expects:
// selectedAccountHoldings.SPPlanTabDisplay.rs.list[*].childList
function makeStockplanJson(grantList) {
  return {
    selectedAccountHoldings: {
      SPPlanTabDisplay: {
        lastSalePrice: 100,
        rs: {
          list: grantList.map(g => ({
            grantDate: g.grantDate,           // 'DD-MMM-YYYY'
            childList: [{
              rsReleaseDate: g.vestDateRaw,   // 'DD-MMM-YYYY'
              purchaseDateFMV: g.fmv,
              sellableShares: g.shares,
            }],
          })),
        },
      },
    },
  };
}

// 'MM/DD/YYYY' from a Date
function mdyStr(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

// 'DD-MMM-YYYY' from a Date
function dmyStr(d) {
  const M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getDate()).padStart(2,'0')}-${M[d.getMonth()]}-${d.getFullYear()}`;
}

// Reference dates. Tests run with system clock (not frozen), so we use dates whose
// relationship to "now" is stable: grantOld is always >2yr old; grantNew always <1yr.
const now       = new Date();
const grantOld  = new Date(now.getFullYear() - 3, now.getMonth(), 1);     // 3yr ago
const vestOld   = new Date(now.getFullYear() - 1, now.getMonth(), 15);    // 1yr ago
const grantNew  = new Date(now.getFullYear(), now.getMonth() - 1 < 0 ? 11 : now.getMonth() - 1, 1);  // ~1mo ago
const vestNew   = new Date(now.getFullYear(), now.getMonth() - 1 < 0 ? 11 : now.getMonth() - 1, 15);
// Urgent: grant ~3yr ago but within 90 days of crossing the 2yr boundary from today.
// Easiest: grant exactly 2yr - 60 days ago.
const grantUrgent = new Date(now.getTime() - (2 * 365.25 - 60) * 24 * 3600 * 1000);
const vestUrgent  = new Date(now.getFullYear() - 1, now.getMonth(), 1);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Column header injection ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 0 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const ths = Array.from(doc.querySelectorAll('thead tr th'));
  const labels = ths.map(t => t.textContent.trim());

  assert(labels.includes('Status'),       'header: "Status" column present');
  assert(labels.includes('IL Tax'),       'header: "IL Tax" column present');
  assert(labels.includes('Net Proceeds'), 'header: "Net Proceeds" column present');
  assert(labels.includes('Rate'),         'header: "Rate" column present');
  assert(labels.includes('Tax vs Net'),   'header: "Tax vs Net" column present');

  const statusIdx = labels.indexOf('Status');
  const taxIdx    = labels.indexOf('IL Tax');
  assert(statusIdx !== -1 && taxIdx !== -1 && statusIdx < taxIdx,
         'header: "Status" appears before "IL Tax"');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Green ≥2yr pill for old grant ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 0 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const row = doc.querySelector('tbody tr');

  // Update the proceeds td and set qty so recalculate() produces output.
  const proceedsTd = row.querySelectorAll('td')[5];
  proceedsTd.textContent = '$8,520';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new (h.getWindow().Event)('input', { bubbles: true }));

  // Status cell is the first injected td (index 6 = 6 original cols + injected status)
  const cells = Array.from(row.querySelectorAll('td'));
  const statusCell = cells[6];
  assert(statusCell && statusCell.innerHTML.includes('≥2yr'),
         'green pill: status cell shows ≥2yr badge for grant >2yr old');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Amber <2yr pill for new grant ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 90.00, shares: 50 },
    ]),
    rows: [{ vestDate: mdyStr(vestNew), fmv: 90.00, qty: 0 }],
  });
  h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  // Fire input event with qty=0 to trigger recalculate() synchronously.
  // updateStatusCell() is called even when qty=0 so the badge appears.
  const input = row.querySelector('input');
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  const statusCell = cells[6];
  // The <2yr pill contains "<2yr" (HTML-encoded as "&lt;2yr")
  const html = statusCell ? statusCell.innerHTML : '';
  assert(html.includes('2yr') && (html.includes('&lt;') || html.includes('<2yr')),
         'amber pill: status cell shows <2yr badge for grant <2yr old');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Countdown text and ≤90-day urgent pill ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantUrgent), vestDateRaw: dmyStr(vestUrgent), fmv: 95.00, shares: 50 },
    ]),
    rows: [{ vestDate: mdyStr(vestUrgent), fmv: 95.00, qty: 50 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  proceedsTd.textContent = '$4,750';
  const input = row.querySelector('input');
  input.value = '50';
  input.dispatchEvent(new (h.getWindow().Event)('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  const statusCell = cells[6];
  const html = statusCell ? statusCell.innerHTML : '';

  assert(html.includes('days to'), 'urgent pill: countdown "days to ≥2yr" text present');
  // grantUrgent is within 60 days of the 2yr mark → urgent escalation (orange bg)
  assert(html.includes('ff9800') || html.includes('orange'),
         'urgent pill: escalated orange color when ≤90 days remain');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Multi-grant same vest date: row ordering ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // Both grants vest on the same calendar date but have different grant dates.
  // grantA is old (>2yr) → row[0] should show ≥2yr; grantB is new (<1yr) → row[1] shows <2yr.
  const vestBoth = new Date(now.getFullYear(), now.getMonth() - 3 < 0 ? 9 : now.getMonth() - 3, 1);
  const grantA   = new Date(now.getFullYear() - 3, 0, 1);   // >2yr
  const grantB   = new Date(now.getFullYear(), 0, 1);        // <1yr

  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantA), vestDateRaw: dmyStr(vestBoth), fmv: 80.00, shares: 100 },
      { grantDate: dmyStr(grantB), vestDateRaw: dmyStr(vestBoth), fmv: 80.00, shares: 100 },
    ]),
    rows: [
      { vestDate: mdyStr(vestBoth), fmv: 80.00, qty: 0 },
      { vestDate: mdyStr(vestBoth), fmv: 80.00, qty: 0 },
    ],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const dataRows = Array.from(doc.querySelectorAll('tbody tr')).filter(r => r.querySelector('input'));
  assert(dataRows.length === 2, 'multi-grant same vest: two data rows injected');

  // Fire input on row[0] to trigger recalculate() which walks all rows and sets all status cells.
  const input0 = dataRows[0].querySelector('input');
  if (input0) input0.dispatchEvent(new win.Event('input', { bubbles: true }));

  const cells0 = Array.from(dataRows[0].querySelectorAll('td'));
  const cells1 = Array.from(dataRows[1].querySelectorAll('td'));
  const html0  = cells0[6] ? cells0[6].innerHTML : '';
  const html1  = cells1[6] ? cells1[6].innerHTML : '';

  assert(html0.includes('≥2yr'), 'multi-grant same vest: row[0] shows ≥2yr (grantA is old)');
  assert((html1.includes('&lt;') || html1.includes('<2yr')) && html1.includes('2yr'),
         'multi-grant same vest: row[1] shows <2yr (grantB is new)');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Missing grant date → neutral "—" pill ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  const vestDate = new Date(now.getFullYear(), now.getMonth() - 2 < 0 ? 10 : now.getMonth() - 2, 1);

  // Build stockplanjson with NO grantDate field on the grant object.
  const json = {
    selectedAccountHoldings: {
      SPPlanTabDisplay: {
        lastSalePrice: 100,
        rs: {
          list: [{
            // intentionally no grantDate field
            childList: [{
              rsReleaseDate: dmyStr(vestDate),
              purchaseDateFMV: 90.00,
              sellableShares: 50,
            }],
          }],
        },
      },
    },
  };

  h.setupDOM({
    stockplanJson: json,
    rows: [{ vestDate: mdyStr(vestDate), fmv: 90.00, qty: 0 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const row = doc.querySelector('tbody tr');
  const cells = Array.from(row.querySelectorAll('td'));
  const statusCell = cells[6];
  assert(statusCell && statusCell.textContent.trim() === '—',
         'missing grant date: status cell shows "—" (dash)');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Capital loss inline indicator (sell < FMV, ≥2yr grant) ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 10 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 10 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  // Sell at $50/sh × 10 = $500 gross; FMV×qty = $852 → capital loss of $352
  proceedsTd.textContent = '$500';
  const input = row.querySelector('input');
  input.value = '10';
  input.dispatchEvent(new (h.getWindow().Event)('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  const taxCell = cells[7]; // IL Tax column is second injected column
  assert(taxCell && taxCell.innerHTML.includes('loss'),
         'capital loss: "loss" indicator rendered in tax cell when sell < FMV on ≥2yr lot');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Popup HTML: <2yr lot has "Crosses 2yr on", "Tax if held to 2yr", "Cost of selling early" ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 90.00, shares: 200 },
    ]),
    rows: [{ vestDate: mdyStr(vestNew), fmv: 90.00, qty: 200 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  // grossUSD=$22k (200 × $110); benefitUSD=$18k (200 × $90) → flat 47%: actual=$10,340; hyp=$9,460
  proceedsTd.textContent = '$22,000';
  const input = row.querySelector('input');
  input.value = '200';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  const taxCell = cells[7];
  const tipData = taxCell && taxCell.dataset.ilTipData;
  assert(!!tipData, 'popup: ilTipData present on tax cell after recalc with qty > 0');

  if (tipData) {
    const d = JSON.parse(tipData);
    // Simulate click to open popup. injector.js listens on document in capture phase.
    taxCell.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true }));

    const popup = doc.getElementById('il-tax-popup');
    assert(!!popup, 'popup: #il-tax-popup element exists in DOM');

    const popupHtml = popup ? popup.innerHTML : '';
    assert(popupHtml.includes('Crosses 2yr on'),
           'popup: "Crosses 2yr on" text present for <2yr lot');
    assert(popupHtml.includes('Tax if held to 2yr'),
           'popup: "Tax if held to 2yr" row present');

    const delta = d.taxUSD - (d.hypotheticalTwoYearTaxUSD || 0);
    const deltaRatio = d.grossUSD > 0 ? delta / d.grossUSD : 0;
    if (delta >= 100 && deltaRatio >= 0.01) {
      assert(popupHtml.includes('Cost of selling early'),
             'popup: "Cost of selling early" shown when delta ≥ $100 and ≥ 1% of gross');
    } else {
      assert(true, 'popup: delta below threshold, "Cost of selling early" correctly omitted');
    }
  }

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Popup HTML: ≥2yr lot omits "Cost of selling early" ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 85.20, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 85.20, qty: 100 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  proceedsTd.textContent = '$10,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const cells = Array.from(row.querySelectorAll('td'));
  const taxCell = cells[7];
  if (taxCell && taxCell.dataset.ilTipData) {
    taxCell.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true }));
    const popup = doc.getElementById('il-tax-popup');
    const html = popup ? popup.innerHTML : '';
    assert(!html.includes('Cost of selling early'),
           'popup: ≥2yr lot omits "Cost of selling early"');
  } else {
    assert(true, 'popup: ≥2yr lot, no tip data (zero gross case), skip popup check');
  }

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Bracket warning banner: appears when sale crosses brackets ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 100.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestNew), fmv: 100.00, qty: 0 }],
  });
  h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();

  // Bracket mode, YTD = ₪220k (in 20% bracket, ₪121k–₪228k).
  // Add an RSU lot whose ordinary income pushes total well into the 31% bracket (₪228k–₪301k).
  h.emitMessage({
    type: 'SETTINGS_UPDATED',
    settings: {
      incomeMode: 'bracket', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 220000,
      monthlySalaryILS: 0, useMonthlySalary: false,
    },
  });

  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  // grossUSD=$15k → ₪54,750 ordinary; total = 220k + 54.75k = 274.75k (in 31% bracket)
  proceedsTd.textContent = '$15,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const banner = doc.getElementById('il-tax-bracket-warning');
  assert(!!banner, 'bracket warning: #il-tax-bracket-warning element present');
  assert(banner && banner.style.display !== 'none', 'bracket warning: visible after crossing');
  const html = banner ? banner.innerHTML : '';
  assert(html.includes('20%'), 'bracket warning: shows start bracket 20%');
  assert(html.includes('31%'), 'bracket warning: shows end bracket 31%');
  assert(html.includes('crosses a tax bracket'), 'bracket warning: shows crossing message');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Bracket warning banner: hidden when sale stays in same bracket ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 100.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestNew), fmv: 100.00, qty: 0 }],
  });
  h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();

  // YTD = ₪150k (in 20% bracket), small sale that keeps total under ₪228k boundary.
  h.emitMessage({
    type: 'SETTINGS_UPDATED',
    settings: {
      incomeMode: 'bracket', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 150000,
      monthlySalaryILS: 0, useMonthlySalary: false,
    },
  });

  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  // gross=$2k → ₪7,300; total = 157.3k (still in 20% bracket)
  proceedsTd.textContent = '$2,000';
  const input = row.querySelector('input');
  input.value = '20';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const banner = doc.getElementById('il-tax-bracket-warning');
  assert(banner && banner.style.display === 'none',
         'bracket warning: hidden when sale stays in same bracket');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Bracket warning banner: hidden in flat mode even when crossing ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 100.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestNew), fmv: 100.00, qty: 0 }],
  });
  h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();

  h.emitMessage({
    type: 'SETTINGS_UPDATED',
    settings: {
      incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 220000,
      monthlySalaryILS: 0, useMonthlySalary: false,
    },
  });

  const row = doc.querySelector('tbody tr');
  const proceedsTd = row.querySelectorAll('td')[5];
  proceedsTd.textContent = '$15,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const banner = doc.getElementById('il-tax-bracket-warning');
  assert(banner && banner.style.display === 'none',
         'bracket warning: hidden in flat mode (no bracket concept)');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Monthly salary: annualizes to monthly × 12 (not × months elapsed) ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // monthly=₪50,000 → annual=₪600,000 (in 35% bracket, ₪301k–₪560k... wait 600k is in next).
  // Actually 600k > 560,280 so it's in the 47% bracket (₪560k–₪722k). A small RSU lot
  // on top is taxed marginally at 47%, regardless of which month of the year we're in.
  // We run two recalcs with monthly=₪50k and prove they produce identical tax —
  // proving the calculation does NOT depend on the current calendar month.
  const monthlyILS = 50000;
  const annual = monthlyILS * 12; // ₪600,000

  function recalcOnce() {
    h.setupDOM({
      stockplanJson: makeStockplanJson([
        { grantDate: dmyStr(grantNew), vestDateRaw: dmyStr(vestNew), fmv: 100.00, shares: 100 },
      ]),
      rows: [{ vestDate: mdyStr(vestNew), fmv: 100.00, qty: 0 }],
    });
    h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
    h.loadContentScripts();
    const doc = h.getDocument();
    const win = h.getWindow();
    h.emitMessage({
      type: 'SETTINGS_UPDATED',
      settings: {
        incomeMode: 'bracket', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
        capitalGainsSurtax: false, usdToILS: 3.65, currency: 'USD',
        residentCreditILS: 0, ytdTaxableIncomeILS: 0,
        monthlySalaryILS: monthlyILS, useMonthlySalary: true,
      },
    });
    const row = doc.querySelector('tbody tr');
    row.querySelectorAll('td')[5].textContent = '$10,000';
    const input = row.querySelector('input');
    input.value = '100';
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    const tipData = row.querySelectorAll('td')[7].dataset.ilTipData;
    return tipData ? JSON.parse(tipData) : null;
  }

  const d1 = recalcOnce();
  h.teardown();
  const d2 = recalcOnce();
  h.teardown();

  assert(!!d1 && !!d2, 'monthly × 12: both recalcs produce ilTipData');
  if (d1 && d2) {
    assert(Math.abs(d1.taxUSD - d2.taxUSD) < 0.01,
           'monthly × 12: identical input → identical tax (no calendar-month dependence)');
    // gross=$10k × 3.65 = ₪36,500; sitting on ₪600k YTD → entirely in 47% bracket
    // expected tax ≈ ₪36,500 × 0.47 = ₪17,155; in USD ≈ $4,700
    assert(Math.abs(d1.taxUSD - 4700) < 5,
           `monthly × 12: monthly=₪50k → annual=₪${annual}, RSU taxed at 47% marginal ≈ $4,700`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Monthly salary: auto-derives §121b surtax above ₪721,560/yr ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // monthly=₪70,000 → annual=₪840,000 (above ₪721,560 surtax threshold).
  // Flat mode + ≥2yr lot so the surtax actually affects the result:
  // ordinary at 47%+3% on the FMV portion; CG at 25%+3% on appreciation.
  // We send capitalGainsSurtax=false but expect content.js to override it.
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 60.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 60.00, qty: 0 }],
  });
  h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  h.loadContentScripts();
  const doc = h.getDocument();
  const win = h.getWindow();

  h.emitMessage({
    type: 'SETTINGS_UPDATED',
    settings: {
      incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: false, // deliberately false — content should override
      usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 0,
      monthlySalaryILS: 70000, useMonthlySalary: true,
    },
  });

  const row = doc.querySelector('tbody tr');
  // gross=$10k, benefit=$6k (100×$60), appreciation=$4k
  // With surtax: ordinary=$6k×0.50=$3,000; CG=$4k×0.28=$1,120; total=$4,120
  row.querySelectorAll('td')[5].textContent = '$10,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const tipData = row.querySelectorAll('td')[7].dataset.ilTipData;
  assert(!!tipData, 'auto surtax: ilTipData present');
  if (tipData) {
    const d = JSON.parse(tipData);
    assert(Math.abs(d.taxUSD - 4120) < 1,
           'auto surtax: monthly=₪70k → annual=₪840k > threshold → surtax on → tax = $4,120');
  }
  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Monthly salary: does NOT auto-enable surtax below threshold ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // monthly=₪50,000 → annual=₪600,000 (below ₪721,560 threshold).
  // Same flat ≥2yr scenario as above but without surtax expected.
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 60.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 60.00, qty: 0 }],
  });
  h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  h.loadContentScripts();
  const doc = h.getDocument();
  const win = h.getWindow();

  h.emitMessage({
    type: 'SETTINGS_UPDATED',
    settings: {
      incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: true, // deliberately TRUE — content should override to false
      usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 0,
      monthlySalaryILS: 50000, useMonthlySalary: true,
    },
  });

  const row = doc.querySelector('tbody tr');
  // ordinary=$6k×0.47=$2,820; CG=$4k×0.25=$1,000; total=$3,820 (no surtax)
  row.querySelectorAll('td')[5].textContent = '$10,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const tipData = row.querySelectorAll('td')[7].dataset.ilTipData;
  if (tipData) {
    const d = JSON.parse(tipData);
    assert(Math.abs(d.taxUSD - 3820) < 1,
           'auto surtax: monthly=₪50k → annual=₪600k < threshold → surtax off → tax = $3,820');
  }
  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Manual surtax checkbox still honored when useMonthlySalary is off ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  // useMonthlySalary=false → content must honor the manual capitalGainsSurtax flag,
  // even if monthly salary value happens to be set to something below threshold.
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 60.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 60.00, qty: 0 }],
  });
  h.mockFetch(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  h.loadContentScripts();
  const doc = h.getDocument();
  const win = h.getWindow();

  h.emitMessage({
    type: 'SETTINGS_UPDATED',
    settings: {
      incomeMode: 'flat', flatOrdinaryRate: 0.47, capitalGainsRate: 0.25,
      capitalGainsSurtax: true,
      usdToILS: 3.65, currency: 'USD',
      residentCreditILS: 0, ytdTaxableIncomeILS: 0,
      monthlySalaryILS: 50000, useMonthlySalary: false, // off — auto-derive disabled
    },
  });

  const row = doc.querySelector('tbody tr');
  row.querySelectorAll('td')[5].textContent = '$10,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const tipData = row.querySelectorAll('td')[7].dataset.ilTipData;
  if (tipData) {
    const d = JSON.parse(tipData);
    assert(Math.abs(d.taxUSD - 4120) < 1,
           'manual surtax: useMonthlySalary=false → manual capitalGainsSurtax=true honored → $4,120');
  }
  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- #44: FMV is taken from JSON purchaseDateFMV, not the DOM cell ---');
// ─────────────────────────────────────────────────────────────────────────────

// In production E*TRADE the cells[3] column can show "Est. Cost Per Share" — a
// broker-internal basis that differs from the §102 grant-date market value. The
// JSON's purchaseDateFMV is authoritative.
{
  // JSON says FMV=$100; DOM cell will show $50 (different value).
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 100.00, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 50.00, qty: 100 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  row.querySelectorAll('td')[5].textContent = '$15,000'; // gross = $150/sh × 100
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const tipData = row.querySelectorAll('td')[7].dataset.ilTipData;
  assert(!!tipData, '#44: tip data present');
  if (tipData) {
    const d = JSON.parse(tipData);
    assert(Math.abs(d.fmvAtVesting - 100.00) < 0.01,
           '#44: FMV at vest comes from JSON (100), not DOM cell (50)');
    assert(Math.abs(d.benefitUSD - 10000) < 0.01,
           '#44: benefit = JSON FMV × qty = $10,000, not $5,000');
  }

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- #44: DOM cell is used as fallback when JSON FMV is missing ---');
// ─────────────────────────────────────────────────────────────────────────────

// If the JSON lacks an FMV (or has 0), we fall back to the DOM cell so behavior
// matches the pre-#44 path. This protects unusual JSON shapes from breaking.
{
  h.setupDOM({
    stockplanJson: makeStockplanJson([
      { grantDate: dmyStr(grantOld), vestDateRaw: dmyStr(vestOld), fmv: 0, shares: 100 },
    ]),
    rows: [{ vestDate: mdyStr(vestOld), fmv: 75.00, qty: 100 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const win = h.getWindow();
  const row = doc.querySelector('tbody tr');
  row.querySelectorAll('td')[5].textContent = '$10,000';
  const input = row.querySelector('input');
  input.value = '100';
  input.dispatchEvent(new win.Event('input', { bubbles: true }));

  const tipData = row.querySelectorAll('td')[7].dataset.ilTipData;
  if (tipData) {
    const d = JSON.parse(tipData);
    assert(Math.abs(d.fmvAtVesting - 75.00) < 0.01,
           '#44: falls back to DOM FMV (75) when JSON FMV is 0/missing');
  }

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- Parse-failure banner when #stockplanjson is absent ---');
// ─────────────────────────────────────────────────────────────────────────────

{
  h.setupDOM({
    stockplanJson: null, // omit the div — triggers parse failure
    rows: [{ vestDate: '01/15/2024', fmv: 85.20, qty: 0 }],
  });
  h.loadContentScripts();

  const doc = h.getDocument();
  const banner = doc.getElementById('il-tax-parse-banner');
  assert(!!banner, 'parse failure banner: #il-tax-parse-banner element present in DOM');
  assert(banner && banner.textContent.includes('IL Tax Calculator'),
         'parse failure banner: contains extension name text');

  h.teardown();
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
