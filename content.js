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
  usdToILS: 3.65,
  currency: 'USD',
};

let settings = {
  incomeMode: 'flat',
  flatOrdinaryRate: 0.47,
  capitalGainsRate: 0.25,
  capitalGainsSurtax: false,
  residentCreditILS: 7986,
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
  const { handles, totalTaxCell, totalNetCell, totalSplitCell } = injectionResult;
  const now = new Date();

  let priorGainILS = 0;
  let totalBracketGrossILS = 0;
  const bracketHandles = [];
  let totalTaxUSD = 0;
  let totalNetUSD = 0;

  // Tracks how many rows we've processed per vest date — needed to pick the correct
  // grant date when multiple grants vest on the same day (same key in grantDateMap).
  const vestDateCounters = new Map();

  handles.forEach(({ row, taxCell, netCell, rateCell, splitCell }) => {
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

    // 2yr clock runs from GRANT date (תאריך ההענקה), not vest date — look it up from parsed JSON.
    // grantDateMap is keyed by vest date timestamp; value is an ordered array of grant dates
    // (one per grant vesting on that date, in the same order as table rows).
    const mapKey = vestDate.getTime().toString();
    const grantDateArr = parsedData.grantDateMap ? parsedData.grantDateMap.get(mapKey) : null;
    const vestIdx = vestDateCounters.get(mapKey) || 0;
    vestDateCounters.set(mapKey, vestIdx + 1);
    const grantDate = grantDateArr ? (grantDateArr[vestIdx] ?? grantDateArr[0] ?? null) : null;
    const refDate = grantDate || vestDate;
    const yearsSinceVesting = (now - refDate) / (365.25 * 24 * 3600 * 1000);
    const grantDateText = grantDate ? grantDate.toLocaleDateString('en-US') : null;
    console.log('[IL Tax] Row:', dateText, '| vestIdx:', vestIdx, '| grantDate:', grantDateText, '| years:', yearsSinceVesting.toFixed(2));

    const result = calculateLotTax({
      grossUSD, benefitUSD, yearsSinceVesting, mode: settings.incomeMode,
      flatOrdinaryRate: settings.flatOrdinaryRate,
      capitalGainsRate: settings.capitalGainsRate,
      capitalGainsSurtax: settings.capitalGainsSurtax,
      usdToILS: settings.usdToILS,
      priorGainILS,
    });

    if (result.mode === 'bracket') {
      priorGainILS += result.gainILS || 0;
      totalBracketGrossILS += result.grossTaxILS || 0;
      bracketHandles.push({ taxCell, netCell, rateCell, splitCell, grossUSD, benefitUSD, result,
        dateText, fmvAtVesting, qty, yearsSinceVesting, grantDateText });
    } else {
      const netUSD = grossUSD - result.taxUSD;
      updateRowCells({ taxCell, netCell, rateCell, splitCell },
        { taxUSD: result.taxUSD, netUSD, effectiveRate: result.effectiveRate,
          mode: result.mode, currency: settings.currency, usdToILS: settings.usdToILS });
      taxCell.dataset.ilTipData = JSON.stringify({
        dateText, fmvAtVesting, grossUSD, qty, benefitUSD, yearsSinceVesting, grantDateText,
        taxUSD: result.taxUSD, ordinaryTaxUSD: result.ordinaryTaxUSD,
        cgTaxUSD: result.cgTaxUSD, effectiveRate: result.effectiveRate,
        mode: result.mode, usdToILS: settings.usdToILS, currency: settings.currency,
        ordinaryRate: settings.flatOrdinaryRate, cgRate: settings.capitalGainsRate,
      });
      totalTaxUSD += result.taxUSD;
      totalNetUSD += netUSD;
    }
  });

  if (bracketHandles.length > 0) {
    const netBracketTaxILS = Math.max(0, totalBracketGrossILS - settings.residentCreditILS);
    bracketHandles.forEach(({ taxCell, netCell, rateCell, splitCell, grossUSD, benefitUSD, result,
        dateText, fmvAtVesting, qty, yearsSinceVesting, grantDateText }) => {
      const proportion = totalBracketGrossILS > 0 ? result.grossTaxILS / totalBracketGrossILS : 0;
      const lotNetOrdinaryTaxILS = netBracketTaxILS * proportion;
      const lotNetOrdinaryTaxUSD = lotNetOrdinaryTaxILS / settings.usdToILS;
      const cgTaxUSD = result.cgTaxUSD || 0;
      const lotNetTaxUSD = lotNetOrdinaryTaxUSD + cgTaxUSD;
      const netUSD = grossUSD - lotNetTaxUSD;
      const effectiveRate = grossUSD > 0 ? lotNetTaxUSD / grossUSD : 0;
      updateRowCells({ taxCell, netCell, rateCell, splitCell },
        { taxUSD: lotNetTaxUSD, netUSD, effectiveRate, mode: 'bracket',
          currency: settings.currency, usdToILS: settings.usdToILS });
      taxCell.dataset.ilTipData = JSON.stringify({
        dateText, fmvAtVesting, grossUSD, qty, benefitUSD, yearsSinceVesting, grantDateText,
        taxUSD: lotNetTaxUSD, ordinaryTaxUSD: lotNetOrdinaryTaxUSD, cgTaxUSD,
        effectiveRate, mode: 'bracket',
        usdToILS: settings.usdToILS, currency: settings.currency,
        ordinaryRate: settings.flatOrdinaryRate, cgRate: settings.capitalGainsRate,
      });
      totalTaxUSD += lotNetTaxUSD;
      totalNetUSD += netUSD;
    });
  }

  updateTotals(totalTaxCell, totalNetCell, totalSplitCell, totalTaxUSD, totalNetUSD, settings.currency, settings.usdToILS);
}

function tryInject() {
  const table = _findSellableTable();
  if (!table || table.dataset.ilTaxInjected) return;

  parsedData = parseStockPlanFromPage();
  if (!parsedData) {
    console.log('[IL Tax] parseStockPlanFromPage returned null — stockplanjson div missing or unparseable');
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
