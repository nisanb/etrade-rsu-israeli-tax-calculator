// parser.js

// Parses 'DD-MMM-YYYY' format (e.g. '30-AUG-2023') which JS Date() doesn't handle reliably.
function _parseDMY(str) {
  if (!str) return null;
  const MONTHS = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
  const m = str.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})$/i);
  if (!m) return null;
  const mo = MONTHS[m[2].toUpperCase()];
  if (mo === undefined) return null;
  return new Date(parseInt(m[3], 10), mo, parseInt(m[1], 10));
}

function _discoverLots(data) {
  console.log('[IL Tax] stockplanjson keys:', Object.keys(data).join(', '));

  // Real E*TRADE path: selectedAccountHoldings.SPPlanTabDisplay.rs.list[*].childList
  try {
    const list = data.selectedAccountHoldings &&
                 data.selectedAccountHoldings.SPPlanTabDisplay &&
                 data.selectedAccountHoldings.SPPlanTabDisplay.rs &&
                 data.selectedAccountHoldings.SPPlanTabDisplay.rs.list;
    if (Array.isArray(list) && list.length > 0) {
      const lots = [];
      for (const grant of list) {
        if (Array.isArray(grant.childList)) {
          for (const child of grant.childList) {
            if ((child.sellableShares || 0) > 0) lots.push(child);
          }
        }
      }
      if (lots.length > 0) {
        console.log('[IL Tax] Lots found via real path. Count:', lots.length, '| First item keys:', Object.keys(lots[0]).join(', '));
        return lots;
      }
    }
  } catch (e) {}

  // Fallback: try known key patterns for sellable holdings
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
        console.log('[IL Tax] Lots found via fallback. Count:', arr.length, '| First item keys:', Object.keys(arr[0]).join(', '));
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
    raw.planId ?? raw.grantId ?? raw.grantID ?? raw.id ?? raw.awardId ?? String(Math.random());

  const vestDateStr =
    raw.rsReleaseDate ?? raw.vestDate ?? raw.vestingDate ?? raw.vest_date ?? raw.awardDate ?? raw.expirationDate ?? null;
  const vestDate = _parseDMY(vestDateStr) || (vestDateStr ? new Date(vestDateStr) : new Date(0));

  const fmvAtVesting = parseFloat(
    raw.purchaseDateFMV ?? raw.vestFMV ?? raw.fmv ?? raw.vestingFMV ?? raw.fairMarketValue ?? raw.grantPrice ?? 0
  );

  const sharesAvailable = parseInt(
    raw.sellableShares ?? raw.sharesAvailable ?? raw.availableShares ?? raw.quantity ?? raw.shares ?? raw.remainingShares ?? 0,
    10
  );

  return { grantId, vestDate, fmvAtVesting, sharesAvailable, symbol: raw.symbol || 'INTC' };
}

function _findMarketPrice(data) {
  // Try standard quotes path
  const quoteArr = data.quotes && data.quotes.QuoteResponse;
  if (quoteArr && quoteArr.length > 0) {
    const p = parseFloat(quoteArr[0].lastPrice || quoteArr[0].price || quoteArr[0].last);
    if (p > 0) { console.log('[IL Tax] Market price from quotes.QuoteResponse:', p); return p; }
  }

  // Try alternate quote key names
  for (const qkey of ['quote', 'stockQuote', 'quoteData', 'priceData']) {
    const q = data[qkey];
    if (!q) continue;
    const p = parseFloat(q.lastPrice || q.price || q.last || q.lastSalePrice);
    if (p > 0) { console.log('[IL Tax] Market price from', qkey, ':', p); return p; }
  }

  // Try SPPlanTabDisplay level
  const spt = data.selectedAccountHoldings && data.selectedAccountHoldings.SPPlanTabDisplay;
  if (spt) {
    const p = parseFloat(spt.lastSalePrice || spt.marketPrice || spt.currentPrice);
    if (p > 0) { console.log('[IL Tax] Market price from SPPlanTabDisplay:', p); return p; }
  }

  // Try first lot — some schemas embed current price per lot
  const rawLots = data.selectedAccountHoldings &&
    data.selectedAccountHoldings.SPPlanTabDisplay &&
    data.selectedAccountHoldings.SPPlanTabDisplay.rs &&
    data.selectedAccountHoldings.SPPlanTabDisplay.rs.list;
  if (Array.isArray(rawLots) && rawLots.length > 0) {
    const p = parseFloat(rawLots[0].lastSalePrice || rawLots[0].marketPrice || rawLots[0].currentPrice);
    if (p > 0) { console.log('[IL Tax] Market price from grant list:', p); return p; }
  }

  console.log('[IL Tax] Market price not found in JSON. Top-level keys:', Object.keys(data).join(', '));
  return null;
}

function parseStockPlanJson(data) {
  const marketPrice = _findMarketPrice(data);

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
