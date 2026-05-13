// content.js

// Injects a main-world script that fires 'il-tax-qty' whenever React sets a quantity input's value.
// Content scripts run in an isolated world so cannot patch HTMLInputElement.prototype directly.
function _patchMainWorldValueSetter() {
  if (document.getElementById('il-tax-patch')) return;
  const s = document.createElement('script');
  s.id = 'il-tax-patch';
  s.textContent = `(function() {
    if (window.__ilTaxPatched) return;
    window.__ilTaxPatched = true;
    var orig = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      get: orig.get, configurable: true,
      set: function(v) {
        var prev = orig.get.call(this);
        orig.set.call(this, v);
        if (String(v) !== String(prev) && this.placeholder === '0' && this.classList.contains('form-control')) {
          this.dispatchEvent(new CustomEvent('il-tax-qty', {bubbles: true}));
        }
      }
    });
  })()`;
  (document.head || document.documentElement).appendChild(s);
}

// Parses 'MM/DD/YYYY' (E*TRADE vest date format) reliably without relying on Date string parsing.
function _parseMDY(str) {
  if (!str) return new Date(0);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return new Date(0);
  return new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

const STORAGE_DEFAULTS = {
  sellPrice: null,
  incomeMode: 'flat',
  flatOrdinaryRate: 47,
  capitalGainsRate: 25,
  capitalGainsSurtax: false,
  residentCreditILS: 7986,
  usdToILS: 3.65,
  currency: 'USD',
};

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
      if (el) {
        console.log('[IL Tax] Table found via selector:', sel);
        return el;
      }
    } catch (e) {}
  }

  // Last resort: any table on the page that has an input inside it
  const allTables = Array.from(document.querySelectorAll('table'));
  console.log('[IL Tax] Specific selectors failed. Scanning', allTables.length, 'tables...');
  for (const t of allTables) {
    const inputs = t.querySelectorAll('input');
    if (inputs.length > 0) {
      console.log('[IL Tax] Table found via input heuristic. Classes:', t.className);
      return t;
    }
  }

  if (allTables.length === 0) {
    console.log('[IL Tax] No tables found on page yet — React may not have rendered.');
  }
  return null;
}

function recalculate() {
  if (!injectionResult || !parsedData) return;
  const { handles, totalTaxCell, totalNetCell } = injectionResult;
  const sellPrice = settings.sellPrice || parsedData.marketPrice;
  const now = new Date();

  let priorGainILS = 0;
  let totalBracketGrossILS = 0;
  const bracketHandles = [];
  let totalTaxUSD = 0;
  let totalNetUSD = 0;

  handles.forEach(({ row, taxCell, netCell, rateCell, dateText, fmvText }) => {
    // Re-query the input each time — React may replace the element between renders.
    const qtyInput = row.querySelector('input.form-control[placeholder="0"]');
    const qty = qtyInput ? (parseFloat(qtyInput.value) || 0) : 0;

    // Read vest date and FMV directly from the DOM cells captured at injection time
    const vestDate = _parseMDY(dateText);
    const fmvMatch = fmvText.match(/[\d,]+\.?\d*/);
    const fmvAtVesting = fmvMatch ? parseFloat(fmvMatch[0].replace(',', '')) : 0;

    if (qty <= 0 || !sellPrice) {
      updateRowCells({ taxCell, netCell, rateCell },
        { taxUSD: 0, netUSD: (sellPrice || 0) * qty, effectiveRate: 0, mode: 'zero',
          currency: settings.currency, usdToILS: settings.usdToILS });
      return;
    }

    const yearsSinceVesting = (now - vestDate) / (365.25 * 24 * 3600 * 1000);
    const gainUSD = Math.max(0, (sellPrice - fmvAtVesting) * qty);
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
  const table = _findSellableTable();
  if (!table || table.dataset.ilTaxInjected) return;

  parsedData = parseStockPlanFromPage();
  if (!parsedData) {
    console.log('[IL Tax] parseStockPlanFromPage returned null — stockplanjson div missing or unparseable');
    return;
  }

  console.log('[IL Tax] Injecting into table. Market price:', parsedData.marketPrice);
  table.dataset.ilTaxMarketPrice = parsedData.marketPrice != null ? String(parsedData.marketPrice) : 'null';
  injectionResult = injectColumns(table);
  if (!injectionResult) return;

  console.log('[IL Tax] Injected', injectionResult.handles.length, 'row handles');

  // Capture phase (true) fires before E*TRADE's stopPropagation can block bubbling.
  table.addEventListener('input', recalculate, true);
  table.addEventListener('change', recalculate, true);

  chrome.storage.sync.get(STORAGE_DEFAULTS, (stored) => {
    settings = {
      ...settings,
      ...stored,
      flatOrdinaryRate: (stored.flatOrdinaryRate ?? 47) / 100,
      capitalGainsRate: (stored.capitalGainsRate ?? 25) / 100,
      sellPrice: stored.sellPrice || null,
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
