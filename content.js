// content.js

// Parses 'MM/DD/YYYY' (E*TRADE vest date format) reliably without relying on Date string parsing.
function _parseMDY(str) {
  if (!str) return new Date(0);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return new Date(0);
  return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

const STORAGE_DEFAULTS = {
  incomeMode: 'flat',
  flatOrdinaryRate: 47,
  capitalGainsRate: 25,
  capitalGainsSurtax: false,
  residentCreditILS: 7986,
  ytdTaxableIncomeILS: 0,
  monthlySalaryILS: 0,
  useMonthlySalary: false,
  usdToILS: 3.65,
  currency: 'USD',
};

let settings = {
  incomeMode: 'flat',
  flatOrdinaryRate: 0.47,
  capitalGainsRate: 0.25,
  capitalGainsSurtax: false,
  residentCreditILS: 7986,
  ytdTaxableIncomeILS: 0,
  monthlySalaryILS: 0,
  useMonthlySalary: false,
  usdToILS: 3.65,
  currency: 'USD',
};

let injectionResult = null;
let parsedData = null;

// Finds the sellable holdings table using multiple strategies.
function _findSellableTable() {
  const strategies = [
    'table.table-presentation.table-striped',
    'table.et-table--sellable',
    '[class*="sellable"] table',
    '[class*="Sellable"] table',
    '[class*="sell"] table',
    '[id*="sellable"] table',
    '[data-testid*="sellable"] table',
  ];
  for (const sel of strategies) {
    try {
      const el = document.querySelector(sel);
      if (el) { console.log('[IL Tax] Table found via selector:', sel); return el; }
    } catch (e) {}
  }
  const allTables = Array.from(document.querySelectorAll('table'));
  for (const t of allTables) {
    if (t.querySelectorAll('input').length > 0) {
      console.log('[IL Tax] Table found via input heuristic. Classes:', t.className);
      return t;
    }
  }
  return null;
}

function recalculate() {
  if (!injectionResult || !parsedData) return;
  const { handles, totalTaxCell, totalNetCell, totalSplitCell, warningBanner } = injectionResult;
  const now = new Date();

  // Israeli income tax is computed annually, so when the user opts into the
  // monthly-salary mode we annualize directly (monthly × 12) — no YTD bookkeeping
  // required. Otherwise fall back to the manual "income already taxed this year"
  // field which the user can set to whatever annual figure they want.
  const annualSalaryILS = (settings.monthlySalaryILS || 0) * 12;
  const effectiveAnnualILS = settings.useMonthlySalary
    ? annualSalaryILS
    : (settings.ytdTaxableIncomeILS || 0);

  // §121b 3% surtax applies above ₪721,560/yr. In bracket mode it's already baked
  // into the 50% top bracket, so the flag only matters for flat mode and for CG.
  // When useMonthlySalary is on we auto-derive it from annualized salary; otherwise
  // honor whatever the user manually set.
  const SURTAX_THRESHOLD_ILS = 721560;
  const effectiveSurtax = settings.useMonthlySalary
    ? annualSalaryILS > SURTAX_THRESHOLD_ILS
    : !!settings.capitalGainsSurtax;

  let priorGainILS = settings.incomeMode === 'bracket' ? effectiveAnnualILS : 0;
  const bracketStartILS = priorGainILS;
  let totalBracketGrossILS = 0;
  const bracketHandles = [];
  let totalTaxUSD = 0;
  let totalNetUSD = 0;

  // Tracks how many rows we've processed per vest date — needed to pick the correct
  // grant date when multiple grants vest on the same day (same key in grantDateMap).
  const vestDateCounters = new Map();

  handles.forEach(({ row, statusCell, taxCell, netCell, rateCell, splitCell }) => {
    // Re-query the input each time — React may replace the element between renders.
    const qtyInput = row.querySelector('input.form-control[placeholder="0"]');
    const qty = qtyInput ? (parseFloat(qtyInput.value) || 0) : 0;

    // Read gross proceeds from the td immediately after the input's td — E*TRADE updates this live.
    const inputTd = qtyInput ? qtyInput.closest('td') : null;
    const proceedsTd = inputTd ? inputTd.nextElementSibling : null;
    const proceedsText = proceedsTd ? proceedsTd.textContent.trim() : '';
    const proceedsMatch = proceedsText.match(/[\d,]+\.?\d*/);
    const grossUSD = qty > 0 && proceedsMatch ? parseFloat(proceedsMatch[0].replace(/,/g, '')) : 0;

    // Read vest date and FMV dynamically — not captured at injection time to avoid stale data
    // after React re-renders rows with different lot data.
    const cells = row.querySelectorAll('td');
    const dateText = cells[1] ? cells[1].textContent.trim() : '';
    const fmvText  = cells[3] ? cells[3].textContent.trim() : '0';

    const vestDate = _parseMDY(dateText);
    const fmvMatch = fmvText.match(/[\d,]+\.?\d*/);
    const fmvAtVesting = fmvMatch ? parseFloat(fmvMatch[0].replace(',', '')) : 0;

    // 2yr clock runs from GRANT date (תאריך ההענקה), not vest date — look it up from parsed JSON.
    // grantDateMap is keyed by vest date timestamp; value is an ordered array of grant dates
    // (one per grant vesting on that date, in the same order as table rows).
    // Counter is incremented here (before any early return) so ordering stays consistent.
    const mapKey = vestDate.getTime().toString();
    const grantDateArr = parsedData.grantDateMap ? parsedData.grantDateMap.get(mapKey) : null;
    const vestIdx = vestDateCounters.get(mapKey) || 0;
    vestDateCounters.set(mapKey, vestIdx + 1);
    const grantDate = grantDateArr ? (grantDateArr[vestIdx] ?? grantDateArr[0] ?? null) : null;
    const refDate = grantDate || vestDate;
    const yearsSinceVesting = (now - refDate) / (365.25 * 24 * 3600 * 1000);
    const grantDateText = grantDate ? grantDate.toLocaleDateString('en-US') : null;
    console.log('[IL Tax] Row:', dateText, '| vestIdx:', vestIdx, '| grantDate:', grantDateText, '| years:', yearsSinceVesting.toFixed(2));

    // 2yr boundary countdown — compute days remaining and the date when the lot crosses 2yr.
    // The clock runs from grant date (or vest date fallback), same as yearsSinceVesting.
    const TWO_YEAR_MS = 2 * 365.25 * 24 * 3600 * 1000;
    const crossesAtMs = refDate.getTime() + TWO_YEAR_MS;
    const daysToTwoYear = yearsSinceVesting < 2
      ? Math.ceil((crossesAtMs - now.getTime()) / (24 * 3600 * 1000))
      : null;
    const crossesAtText = daysToTwoYear !== null
      ? new Date(crossesAtMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null;

    // Initial status cell update — no tax amount yet (qty may be 0). Countdown shows but
    // the savings tooltip is suppressed until we have a real tax figure (see updates below).
    if (statusCell) updateStatusCell(statusCell, { grantDate, yearsSinceGrant: yearsSinceVesting, daysToTwoYear, crossesAtText, hypotheticalTwoYearTaxUSD: null, currentTaxUSD: null });

    if (qty <= 0 || grossUSD <= 0) {
      updateRowCells({ taxCell, netCell, rateCell, splitCell },
        { taxUSD: 0, netUSD: 0, effectiveRate: 0, mode: 'zero',
          currency: settings.currency, usdToILS: settings.usdToILS });
      delete taxCell.dataset.ilTipData;
      return;
    }

    // Section 102 income track:
    //   benefitUSD = FMV × qty (ordinary income portion, always taxed at marginal rate)
    //   appreciation = max(0, gross - benefit) (capital gain, taxed at 25% if ≥2yr)
    const benefitUSD = fmvAtVesting * qty;

    const result = calculateLotTax({
      grossUSD, benefitUSD, yearsSinceVesting, mode: settings.incomeMode,
      flatOrdinaryRate: settings.flatOrdinaryRate,
      capitalGainsRate: settings.capitalGainsRate,
      capitalGainsSurtax: effectiveSurtax,
      usdToILS: settings.usdToILS,
      priorGainILS,
    });

    if (result.mode === 'bracket') {
      priorGainILS += result.gainILS || 0;
      totalBracketGrossILS += result.grossTaxILS || 0;
      bracketHandles.push({ taxCell, netCell, rateCell, splitCell, grossUSD, benefitUSD, result,
        dateText, fmvAtVesting, qty, yearsSinceVesting, grantDateText, daysToTwoYear, crossesAtText, statusCell });
    } else {
      const netUSD = grossUSD - result.taxUSD;
      // Update status cell again now that we have the actual tax — enables savings tooltip for urgent <2yr lots.
      if (statusCell) updateStatusCell(statusCell, { grantDate, yearsSinceGrant: yearsSinceVesting, daysToTwoYear, crossesAtText, hypotheticalTwoYearTaxUSD: result.hypotheticalTwoYearTaxUSD ?? null, currentTaxUSD: result.taxUSD });
      updateRowCells({ taxCell, netCell, rateCell, splitCell },
        { taxUSD: result.taxUSD, netUSD, effectiveRate: result.effectiveRate,
          mode: result.mode, currency: settings.currency, usdToILS: settings.usdToILS,
          capitalLossUSD: result.capitalLossUSD || 0 });
      taxCell.dataset.ilTipData = JSON.stringify({
        dateText, fmvAtVesting, grossUSD, qty, benefitUSD, yearsSinceVesting, grantDateText,
        taxUSD: result.taxUSD, ordinaryTaxUSD: result.ordinaryTaxUSD,
        cgTaxUSD: result.cgTaxUSD, capitalLossUSD: result.capitalLossUSD || 0,
        effectiveRate: result.effectiveRate,
        mode: result.mode, usdToILS: settings.usdToILS, currency: settings.currency,
        ordinaryRate: settings.flatOrdinaryRate, cgRate: settings.capitalGainsRate,
        daysToTwoYear, crossesAtText,
        hypotheticalTwoYearTaxUSD: result.hypotheticalTwoYearTaxUSD ?? null,
      });
      totalTaxUSD += result.taxUSD;
      totalNetUSD += netUSD;
    }
  });

  if (bracketHandles.length > 0) {
    const netBracketTaxILS = Math.max(0, totalBracketGrossILS - settings.residentCreditILS);
    bracketHandles.forEach(({ taxCell, netCell, rateCell, splitCell, grossUSD, benefitUSD, result,
        dateText, fmvAtVesting, qty, yearsSinceVesting, grantDateText, daysToTwoYear, crossesAtText, statusCell }) => {
      const proportion = totalBracketGrossILS > 0 ? result.grossTaxILS / totalBracketGrossILS : 0;
      const lotNetOrdinaryTaxILS = netBracketTaxILS * proportion;
      const lotNetOrdinaryTaxUSD = lotNetOrdinaryTaxILS / settings.usdToILS;
      const cgTaxUSD = result.cgTaxUSD || 0;
      const lotNetTaxUSD = lotNetOrdinaryTaxUSD + cgTaxUSD;
      const netUSD = grossUSD - lotNetTaxUSD;
      const effectiveRate = grossUSD > 0 ? lotNetTaxUSD / grossUSD : 0;
      // Update status cell now that we have the final net tax for this bracket lot.
      const grantDate = grantDateText ? new Date(grantDateText) : null;
      if (statusCell) updateStatusCell(statusCell, { grantDate, yearsSinceGrant: yearsSinceVesting, daysToTwoYear, crossesAtText, hypotheticalTwoYearTaxUSD: result.hypotheticalTwoYearTaxUSD ?? null, currentTaxUSD: lotNetTaxUSD });
      updateRowCells({ taxCell, netCell, rateCell, splitCell },
        { taxUSD: lotNetTaxUSD, netUSD, effectiveRate, mode: 'bracket',
          currency: settings.currency, usdToILS: settings.usdToILS,
          capitalLossUSD: result.capitalLossUSD || 0 });
      taxCell.dataset.ilTipData = JSON.stringify({
        dateText, fmvAtVesting, grossUSD, qty, benefitUSD, yearsSinceVesting, grantDateText,
        taxUSD: lotNetTaxUSD, ordinaryTaxUSD: lotNetOrdinaryTaxUSD, cgTaxUSD,
        capitalLossUSD: result.capitalLossUSD || 0,
        effectiveRate, mode: 'bracket',
        usdToILS: settings.usdToILS, currency: settings.currency,
        ordinaryRate: settings.flatOrdinaryRate, cgRate: settings.capitalGainsRate,
        daysToTwoYear, crossesAtText,
        hypotheticalTwoYearTaxUSD: result.hypotheticalTwoYearTaxUSD ?? null,
      });
      totalTaxUSD += lotNetTaxUSD;
      totalNetUSD += netUSD;
    });
  }

  updateTotals(totalTaxCell, totalNetCell, totalSplitCell, totalTaxUSD, totalNetUSD, settings.currency, settings.usdToILS);

  // Bracket-crossing warning: only meaningful in bracket mode, only when RSU ordinary
  // income was actually added (priorGainILS moved forward). Shows when the sale ends
  // in a higher bracket than it started.
  if (warningBanner) {
    const bracketEndILS = priorGainILS;
    const crossed = settings.incomeMode === 'bracket'
      && bracketEndILS > bracketStartILS
      && bracketIndexFor(bracketEndILS, IL_BRACKETS_2026) > bracketIndexFor(bracketStartILS, IL_BRACKETS_2026);
    if (crossed) {
      const startIdx  = bracketIndexFor(bracketStartILS, IL_BRACKETS_2026);
      const endIdx    = bracketIndexFor(bracketEndILS, IL_BRACKETS_2026);
      const startBkt  = IL_BRACKETS_2026[startIdx];
      const endBkt    = IL_BRACKETS_2026[endIdx];
      const boundary  = IL_BRACKETS_2026[endIdx - 1].limit;
      const overILS   = Math.max(0, bracketEndILS - boundary);
      warningBanner.show({
        startRatePct: Math.round(startBkt.rate * 100),
        endRatePct:   Math.round(endBkt.rate * 100),
        startRangeLabel: _bracketRangeLabel(startIdx),
        endRangeLabel:   _bracketRangeLabel(endIdx),
        overILS,
      });
    } else {
      warningBanner.hide();
    }
  }
}

function _bracketRangeLabel(idx) {
  const lo = idx === 0 ? 0 : IL_BRACKETS_2026[idx - 1].limit;
  const hi = IL_BRACKETS_2026[idx].limit;
  const fmt = n => '₪' + Math.round(n).toLocaleString('en-US');
  return hi === Infinity ? `above ${fmt(lo)}` : `${fmt(lo)}–${fmt(hi)}`;
}

function tryInject() {
  const table = _findSellableTable();
  if (!table || table.dataset.ilTaxInjected) return;

  parsedData = parseStockPlanFromPage();
  if (!parsedData) {
    console.log('[IL Tax] parseStockPlanFromPage returned null — stockplanjson div missing or unparseable');
    injectParseFailureBanner(table);
    return;
  }

  console.log('[IL Tax] Injecting into table. Market price:', parsedData.marketPrice);
  injectionResult = injectColumns(table);
  if (!injectionResult) return;

  console.log('[IL Tax] Injected', injectionResult.handles.length, 'row handles');
  _startQtyPoller();

  // Capture phase fires before E*TRADE's stopPropagation can block bubbling.
  table.addEventListener('input', recalculate, true);
  table.addEventListener('change', recalculate, true);

  chrome.storage.sync.get(STORAGE_DEFAULTS, (stored) => {
    settings = {
      ...settings,
      ...stored,
      flatOrdinaryRate: (stored.flatOrdinaryRate ?? 47) / 100,
      capitalGainsRate: (stored.capitalGainsRate ?? 25) / 100,
    };
    if (typeof getExchangeRate === 'function') {
      getExchangeRate().then(rateData => {
        if (rateData) settings.usdToILS = rateData.rate;
        recalculate();
      });
    } else {
      recalculate();
    }
  });
}

// Polls input values every 150ms to catch programmatic changes (e.g. E*TRADE "Select" button).
// React captures the original HTMLInputElement.prototype.value setter before content scripts run,
// so prototype patching is unreliable. Polling is the only reliable cross-React solution.
let _qtyPollHandle = null;
function _startQtyPoller() {
  if (_qtyPollHandle !== null) return;
  const snapshot = new Map();
  _qtyPollHandle = setInterval(() => {
    if (!injectionResult) return;
    let changed = false;
    injectionResult.handles.forEach(({ row }) => {
      const input = row.querySelector('input.form-control[placeholder="0"]');
      const val = input ? input.value : '';
      if (snapshot.get(row) !== val) { snapshot.set(row, val); changed = true; }
    });
    if (changed) recalculate();
  }, 150);
}

console.log('[IL Tax] Content script loaded. URL:', location.href);

const observer = new MutationObserver(tryInject);
observer.observe(document.getElementById('application') || document.body, {
  childList: true, subtree: true,
});
tryInject();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SETTINGS_UPDATED') {
    settings = { ...settings, ...msg.settings };
    recalculate();
  }
});
