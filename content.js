// content.js

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

  handles.forEach(({ qtyInput, taxCell, netCell, rateCell, grantId }) => {
    const qty = parseFloat(qtyInput.value) || 0;
    const lot = parsedData.lots.find(l => l.grantId === grantId);
    if (!lot || qty <= 0) {
      updateRowCells({ taxCell, netCell, rateCell },
        { taxUSD: 0, netUSD: (sellPrice || 0) * qty, effectiveRate: 0, mode: 'zero',
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

  injectionResult.handles.forEach((handle, i) => {
    handle.grantId = parsedData.lots[i] ? parsedData.lots[i].grantId : null;
  });

  injectionResult.handles.forEach(h => h.qtyInput.addEventListener('input', recalculate));

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
