// parser.js

// Field name constants — verify these against the live E*TRADE page during Task 8.
// Pattern is based on selectedOtherHoldings.otherHoldings observed in stockplan.html.
const SELLABLE_KEY = 'selectedSellableHoldings';
const LOTS_ARRAY_KEY = 'sellableHoldings';
const VEST_DATE_FIELD = 'vestDate';
const FMV_FIELD = 'vestFMV';
const SHARES_FIELD = 'sharesAvailable';
const GRANT_ID_FIELD = 'grantId';

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
