// Run: node tests/test-calculator.js
const fs = require('fs');
eval(fs.readFileSync('calculator.js', 'utf8'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}
function near(a, b, tol = 0.5) { return Math.abs(a - b) <= tol; }

console.log('\n--- bracketTaxForAmount ---');
assert(bracketTaxForAmount(0, IL_BRACKETS_2026) === 0, '₪0 → ₪0');
assert(near(bracketTaxForAmount(50000, IL_BRACKETS_2026), 5000), '₪50k → ₪5,000 (all 10%)');
assert(near(bracketTaxForAmount(84120, IL_BRACKETS_2026), 8412), '₪84,120 → ₪8,412 (top of 10%)');
// ₪100k: 10%×84120=8412 + 14%×15880=2223.2 = 10635.2
assert(near(bracketTaxForAmount(100000, IL_BRACKETS_2026), 10635.2), '₪100k → ₪10,635.20');
// ₪750k: spans into 50% bracket
// 10%×84120=8412 + 14%×36600=5124 + 20%×107280=21456 + 31%×73200=22692 + 35%×259080=90678 + 47%×161280=75801.6 + 50%×28440=14220 = 238383.6
assert(near(bracketTaxForAmount(750000, IL_BRACKETS_2026), 238383.6, 5), '₪750k → into 50% bracket');

console.log('\n--- calculateLotTax: capital gains (≥2yr) ---');
// All appreciation above FMV: benefitUSD=0 so ordinaryBase=0, cgBase=grossUSD
const cg = calculateLotTax({ grossUSD: 10000, benefitUSD: 0, yearsSinceVesting: 2.5, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(cg.taxUSD, 2500), 'CG 25%, $10k → $2,500 tax');
assert(cg.mode === 'capital-gains', 'mode=capital-gains');

const cgSurtax = calculateLotTax({ grossUSD: 10000, benefitUSD: 0, yearsSinceVesting: 3, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: true,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(cgSurtax.taxUSD, 2800), 'CG 25%+3% surtax, $10k → $2,800');

console.log('\n--- calculateLotTax: flat ordinary (<2yr) ---');
// <2yr: entire gross taxed at ordinary rate regardless of benefitUSD
const flat = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(flat.taxUSD, 4700), 'Flat 47%, $10k → $4,700');
assert(flat.mode === 'flat-ordinary', 'mode=flat-ordinary');

console.log('\n--- calculateLotTax: bracket mode, first lot, no prior ---');
// $10k × 3.65 = ₪36,500 → 10% = ₪3,650 gross bracket tax
const brk1 = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(brk1.grossTaxILS, 3650), 'Bracket first lot ₪36.5k → grossTaxILS ₪3,650');
assert(brk1.mode === 'bracket', 'mode=bracket');

console.log('\n--- calculateLotTax: bracket mode, second lot (priorGainILS=₪80k) ---');
// $5k × 3.65 = ₪18,250; prior = ₪80k
// taxOnTotal(₪98,250) = 10%×84120 + 14%×14130 = 8412 + 1978.2 = 10390.2
// taxOnPrior(₪80k)   = 10%×80000 = 8000
// grossTaxILS = 10390.2 - 8000 = 2390.2
const brk2 = calculateLotTax({ grossUSD: 5000, benefitUSD: 5000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 80000 });
assert(near(brk2.grossTaxILS, 2390.2, 1), 'Bracket second lot, ₪80k prior → marginal ₪2,390');

console.log('\n--- zero gross ---');
const zero = calculateLotTax({ grossUSD: 0, benefitUSD: 0, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(zero.taxUSD === 0, 'zero gain → zero tax');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
