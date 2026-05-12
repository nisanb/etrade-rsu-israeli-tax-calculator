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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
