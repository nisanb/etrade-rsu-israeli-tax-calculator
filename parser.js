// parser.js

function _discoverLots(data) {
  console.log('[IL Tax] stockplanjson keys:', Object.keys(data).join(', '));

  // Try known key patterns for sellable holdings
  const attempts = [
    () => data.selectedSellableHoldings && data.selectedSellableHoldings.sellableHoldings,
    () => data.selectedSellableHoldings && data.selectedSellableHoldings.holdings,
    () => data.selectedSellableHoldings && data.selectedSellableHoldings.list,
    () => data.sellableHoldings && data.sellableHoldings.list,
    () => data.sellableHoldings,
  ];

  for (const fn of attempts) {
    try {
      const arr = fn();
      if (Array.isArray(arr) && arr.length > 0) {
        console.log('[IL Tax] Lots found. Count:', arr.length, '| First item keys:', Object.keys(arr[0]).join(', '));
        return arr;
      }
    } catch (e) {}
  }

  // Heuristic: scan nested arrays for objects with a "vest" field
  for (const [k, v] of Object.entries(data)) {
    if (!v || typeof v !== 'object') continue;
    for (const [k2, v2] of Object.entries(v)) {
      if (!Array.isArray(v2) || v2.length === 0 || typeof v2[0] !== 'object') continue;
      const keys = Object.keys(v2[0]).map(s => s.toLowerCase());
      if (keys.some(s => s.includes('vest'))) {
        console.log('[IL Tax] Lots found via heuristic at', k, '->', k2, '| First item keys:', Object.keys(v2[0]).join(', '));
        return v2;
      }
    }
  }

  console.log('[IL Tax] No lots found in stockplanjson');
  return [];
}

function _mapLot(raw) {
  const grantId =
    raw.grantId ?? raw.grantID ?? raw.id ?? raw.awardId ?? String(Math.random());

  const vestDateStr =
    raw.vestDate ?? raw.vestingDate ?? raw.vest_date ?? raw.awardDate ?? raw.expirationDate ?? null;
  const vestDate = vestDateStr ? new Date(vestDateStr) : new Date(0);

  const fmvAtVesting = parseFloat(
    raw.vestFMV ?? raw.fmv ?? raw.vestingFMV ?? raw.fairMarketValue ?? raw.grantPrice ?? 0
  );

  const sharesAvailable = parseInt(
    raw.sharesAvailable ?? raw.availableShares ?? raw.quantity ?? raw.shares ?? raw.remainingShares ?? 0,
    10
  );

  return { grantId, vestDate, fmvAtVesting, sharesAvailable, symbol: raw.symbol || 'INTC' };
}

function parseStockPlanJson(data) {
  const quoteArr = data.quotes && data.quotes.QuoteResponse;
  const marketPrice = quoteArr && quoteArr.length > 0
    ? parseFloat(quoteArr[0].lastPrice)
    : null;

  const rawLots = _discoverLots(data);
  const lots = rawLots.map(_mapLot);

  return { marketPrice, lots };
}

function parseStockPlanFromPage() {
  const el = document.getElementById('stockplanjson');
  if (!el) {
    console.log('[IL Tax] #stockplanjson element not found');
    return null;
  }
  try {
    return parseStockPlanJson(JSON.parse(el.textContent));
  } catch (e) {
    console.error('[IL Tax] Failed to parse stockplanjson:', e);
    return null;
  }
}
