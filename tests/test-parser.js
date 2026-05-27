// Run: node tests/test-parser.js
const fs = require('fs');
eval(fs.readFileSync('parser.js', 'utf8'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

const FIXTURE = {
  quotes: {
    QuoteResponse: [{ symbol: 'INTC', lastPrice: '116.33' }]
  },
  selectedSellableHoldings: {
    sellableHoldings: [
      {
        grantId: 'G001',
        vestDate: '2022-03-15',
        vestFMV: 85.20,
        sharesAvailable: 500,
        symbol: 'INTC',
      },
      {
        grantId: 'G002',
        vestDate: '2024-09-01',
        vestFMV: 22.40,
        sharesAvailable: 250,
        symbol: 'INTC',
      }
    ]
  }
};

const result = parseStockPlanJson(FIXTURE);

console.log('\n--- parseStockPlanJson ---');
assert(typeof result.marketPrice === 'number', 'marketPrice is a number');
assert(result.marketPrice === 116.33, 'marketPrice = 116.33');
assert(Array.isArray(result.lots), 'lots is an array');
assert(result.lots.length === 2, 'two lots');
assert(result.lots[0].grantId === 'G001', 'lot[0].grantId');
assert(result.lots[0].vestDate instanceof Date, 'lot[0].vestDate is Date');
assert(result.lots[0].vestDate.getFullYear() === 2022, 'lot[0] vested 2022');
assert(result.lots[0].fmvAtVesting === 85.20, 'lot[0].fmvAtVesting = 85.20');
assert(result.lots[0].sharesAvailable === 500, 'lot[0].sharesAvailable = 500');
assert(result.lots[1].vestDate.getFullYear() === 2024, 'lot[1] vested 2024');
assert(result.lots[1].fmvAtVesting === 22.40, 'lot[1].fmvAtVesting = 22.40');

// Edge case: missing quotes
const noQuote = parseStockPlanJson({ selectedSellableHoldings: { sellableHoldings: [] } });
assert(noQuote.marketPrice === null, 'null marketPrice when quotes missing');
assert(noQuote.lots.length === 0, 'empty lots array');

// fmvMap: vest-date-keyed map of FMV-at-vesting from JSON (#44)
assert(result.fmvMap instanceof Map, 'fmvMap is a Map');
const lot0Key = result.lots[0].vestDate.getTime().toString();
const lot1Key = result.lots[1].vestDate.getTime().toString();
assert(result.fmvMap.get(lot0Key)[0] === 85.20, 'fmvMap[vest0] = 85.20');
assert(result.fmvMap.get(lot1Key)[0] === 22.40, 'fmvMap[vest1] = 22.40');

// Two lots vesting on the same day → both FMVs preserved in order
const sameDayFixture = {
  selectedSellableHoldings: {
    sellableHoldings: [
      { grantId: 'A', vestDate: '2024-01-15', vestFMV: 50.00, sharesAvailable: 10 },
      { grantId: 'B', vestDate: '2024-01-15', vestFMV: 60.00, sharesAvailable: 20 },
    ],
  },
};
const sameDay = parseStockPlanJson(sameDayFixture);
const sameDayKey = sameDay.lots[0].vestDate.getTime().toString();
assert(sameDay.fmvMap.get(sameDayKey).length === 2, 'fmvMap preserves both FMVs on same vest date');
assert(sameDay.fmvMap.get(sameDayKey)[0] === 50.00, 'fmvMap[vest][0] = first lot FMV');
assert(sameDay.fmvMap.get(sameDayKey)[1] === 60.00, 'fmvMap[vest][1] = second lot FMV');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
