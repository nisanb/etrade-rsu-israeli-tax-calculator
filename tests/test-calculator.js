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

console.log('\n--- §121b surtax: flat mode, <2yr ---');
// surtax on: tax = gross × (flatOrdinaryRate + 0.03) = $10k × 0.50 = $5,000
const flatLt2Surtax = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: true,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(flatLt2Surtax.taxUSD, 5000), 'Flat <2yr surtax on: $10k → $5,000 (47%+3%)');
assert(near(flatLt2Surtax.effectiveRate, 0.50), 'Flat <2yr surtax on: effectiveRate = 0.50');
assert(flatLt2Surtax.mode === 'flat-ordinary', 'Flat <2yr surtax on: mode=flat-ordinary');

// surtax off: tax unchanged from existing flat test ($4,700)
const flatLt2NoSurtax = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(flatLt2NoSurtax.taxUSD, 4700), 'Flat <2yr surtax off: $10k → $4,700 (regression guard)');

console.log('\n--- §121b surtax: flat mode, ≥2yr, sell above FMV ---');
// $10k gross, $6k benefit (ordinary), $4k appreciation (CG)
// surtax on: ordinaryTax = $6k × (0.47+0.03) = $3,000; cgTax = $4k × (0.25+0.03) = $1,120; total = $4,120
const flatGe2Surtax = calculateLotTax({ grossUSD: 10000, benefitUSD: 6000, yearsSinceVesting: 2.5, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: true,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(flatGe2Surtax.ordinaryTaxUSD, 3000), 'Flat ≥2yr surtax on: ordinary $6k×50% = $3,000');
assert(near(flatGe2Surtax.cgTaxUSD, 1120), 'Flat ≥2yr surtax on: CG $4k×28% = $1,120');
assert(near(flatGe2Surtax.taxUSD, 4120), 'Flat ≥2yr surtax on: total = $4,120');

// surtax off: ordinaryTax = $6k×0.47 = $2,820; cgTax = $4k×0.25 = $1,000; total = $3,820
const flatGe2NoSurtax = calculateLotTax({ grossUSD: 10000, benefitUSD: 6000, yearsSinceVesting: 2.5, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(flatGe2NoSurtax.ordinaryTaxUSD, 2820), 'Flat ≥2yr surtax off: ordinary $6k×47% = $2,820');
assert(near(flatGe2NoSurtax.cgTaxUSD, 1000), 'Flat ≥2yr surtax off: CG $4k×25% = $1,000');
assert(near(flatGe2NoSurtax.taxUSD, 3820), 'Flat ≥2yr surtax off: total = $3,820 (regression guard)');

console.log('\n--- §121b surtax: bracket mode, <2yr — surtax flag has no effect ---');
// Bracket mode encodes the surtax in the 50% top bracket; the flag must not double-count.
// $10k × 3.65 = ₪36,500 → 10% bracket → ₪3,650 grossTaxILS (same with or without flag).
const brkSurtaxOn = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: true,
  usdToILS: 3.65, priorGainILS: 0 });
const brkSurtaxOff = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(brkSurtaxOn.grossTaxILS, brkSurtaxOff.grossTaxILS, 0.01),
  'Bracket <2yr: surtax flag does not change bracket tax (no double-count)');
assert(near(brkSurtaxOn.grossTaxILS, 3650), 'Bracket <2yr surtax on: grossTaxILS still ₪3,650');

console.log('\n--- capitalLossUSD: ≥2yr flat, sell below FMV ---');
// grossUSD=5000, benefitUSD=10000: sell price fell below FMV
// ordinaryBase = min(5000,10000) = 5000; cgBase = max(0,5000-10000) = 0
// capitalLossUSD = max(0, 10000-5000) = 5000
// ordinaryTaxUSD = 5000 × 0.47 = 2350; cgTaxUSD = 0
const lossFlat = calculateLotTax({ grossUSD: 5000, benefitUSD: 10000, yearsSinceVesting: 2.5, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(lossFlat.capitalLossUSD, 5000), '≥2yr flat sell<FMV: capitalLossUSD = 5000');
assert(near(lossFlat.cgTaxUSD, 0), '≥2yr flat sell<FMV: cgTaxUSD = 0');
assert(near(lossFlat.ordinaryTaxUSD, 2350), '≥2yr flat sell<FMV: ordinaryTaxUSD = $2,350');
assert(lossFlat.mode === 'capital-gains', '≥2yr flat sell<FMV: mode=capital-gains');

console.log('\n--- capitalLossUSD: ≥2yr flat, sell above FMV (regression guard) ---');
// grossUSD=15000, benefitUSD=10000: appreciation → no loss
const noLossFlat = calculateLotTax({ grossUSD: 15000, benefitUSD: 10000, yearsSinceVesting: 2.5, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(noLossFlat.capitalLossUSD, 0), '≥2yr flat sell>FMV: capitalLossUSD = 0');
assert(near(noLossFlat.cgTaxUSD, 1250), '≥2yr flat sell>FMV: cgTaxUSD = $1,250 (5k×25%)');

console.log('\n--- capitalLossUSD: <2yr flat — field exists, value is 0 ---');
const lt2Loss = calculateLotTax({ grossUSD: 5000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(lt2Loss.capitalLossUSD === 0, '<2yr flat: capitalLossUSD field exists and equals 0');
assert(lt2Loss.mode === 'flat-ordinary', '<2yr flat: mode=flat-ordinary');

console.log('\n--- capitalLossUSD: ≥2yr bracket, sell below FMV ---');
// grossUSD=5000, benefitUSD=10000; ordinaryBase=5000; capitalLossUSD=5000
// ordinaryILS = 5000×3.65 = ₪18,250; grossTaxILS = bracketTax(18250) = 10%×18250 = ₪1,825
const lossBrk = calculateLotTax({ grossUSD: 5000, benefitUSD: 10000, yearsSinceVesting: 2.5, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(lossBrk.capitalLossUSD, 5000), '≥2yr bracket sell<FMV: capitalLossUSD = 5000');
assert(near(lossBrk.cgTaxUSD, 0), '≥2yr bracket sell<FMV: cgTaxUSD = 0');
assert(near(lossBrk.grossTaxILS, 1825), '≥2yr bracket sell<FMV: grossTaxILS ≈ ₪1,825 (tax math unchanged)');

console.log('\n--- hypotheticalTwoYearTaxUSD: <2yr flat, sell price == FMV (no appreciation) ---');
// $10k gross, $10k benefit (sell at FMV): no CG under ≥2yr rules
// hypothetical ordinary = min(10000, 10000)×0.47 = $4,700; hypothetical CG = max(0, 10000-10000)×0.25 = $0
// hypotheticalTwoYearTaxUSD = $4,700 (same as actual, since no appreciation)
const hypFlatAtFMV = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(hypFlatAtFMV.hypotheticalTwoYearTaxUSD, 4700), '<2yr flat, sell=FMV: hyp tax = $4,700 (all ordinary)');
assert(near(hypFlatAtFMV.taxUSD, 4700), '<2yr flat, sell=FMV: actual tax = $4,700');

console.log('\n--- hypotheticalTwoYearTaxUSD: <2yr flat, sell price above FMV (appreciation) ---');
// $15k gross, $10k benefit: under ≥2yr rules ordinary=$10k×0.47=$4,700; CG=$5k×0.25=$1,250; total=$5,950
// actual <2yr: $15k×0.47=$7,050 — savings by waiting = $7,050-$5,950=$1,100
const hypFlatAboveFMV = calculateLotTax({ grossUSD: 15000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(hypFlatAboveFMV.taxUSD, 7050), '<2yr flat, sell>FMV: actual tax = $7,050');
assert(near(hypFlatAboveFMV.hypotheticalTwoYearTaxUSD, 5950), '<2yr flat, sell>FMV: hyp tax = $5,950 (ordinary+CG)');

console.log('\n--- hypotheticalTwoYearTaxUSD: <2yr flat with §121b surtax, sell above FMV ---');
// $15k gross, $10k benefit, surtax on
// actual <2yr: $15k×(0.47+0.03)=$15k×0.50=$7,500
// hyp ≥2yr: ordinary=$10k×0.50=$5,000; CG=$5k×(0.25+0.03)=$5k×0.28=$1,400; total=$6,400
const hypFlatSurtax = calculateLotTax({ grossUSD: 15000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: true,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(hypFlatSurtax.taxUSD, 7500), '<2yr flat surtax on, sell>FMV: actual = $7,500');
assert(near(hypFlatSurtax.hypotheticalTwoYearTaxUSD, 6400), '<2yr flat surtax on, sell>FMV: hyp = $6,400 (50% ordinary + 28% CG)');

console.log('\n--- hypotheticalTwoYearTaxUSD: <2yr bracket mode, sell above FMV ---');
// $15k gross ($15k×3.65=₪54,750), $10k benefit ($10k×3.65=₪36,500), priorGainILS=0
// actual <2yr bracket: tax on ₪54,750 = 10%×54750 = ₪5,475; taxUSD = 5475/3.65 ≈ $1,500
// hyp ≥2yr bracket: ordinary ₪36,500 → 10%×36500=₪3,650; ordTaxUSD=3650/3.65=$1,000; CG=$5k×0.25=$1,250; hypTotal≈$2,250
const hypBrk = calculateLotTax({ grossUSD: 15000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(near(hypBrk.taxUSD, 1500, 5), '<2yr bracket, sell>FMV: actual tax ≈ $1,500');
assert(near(hypBrk.hypotheticalTwoYearTaxUSD, 2250, 5), '<2yr bracket, sell>FMV: hyp ≈ $2,250 (bracket ordinary + flat CG)');
// Note: hyp > actual here because the stock appreciated a lot and CG pushes total higher — this is
// a low-bracket scenario. In typical high-bracket cases, hyp < actual.

console.log('\n--- hypotheticalTwoYearTaxUSD: ≥2yr result — field is null ---');
const hypGe2yr = calculateLotTax({ grossUSD: 10000, benefitUSD: 6000, yearsSinceVesting: 2.5, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
assert(hypGe2yr.hypotheticalTwoYearTaxUSD === undefined || hypGe2yr.hypotheticalTwoYearTaxUSD === null,
  '≥2yr result: hypotheticalTwoYearTaxUSD is null or omitted');

console.log('\n--- YTD income context: bracket mode <2yr shifts to higher marginal rate ---');
// priorGainILS=0: ₪36,500 → 10% bracket → ₪3,650 gross tax
const ytdZero = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
// priorGainILS=500000: already deep in 35%+ brackets; same ₪36,500 lot taxed at much higher marginal rate
const ytdHighIncome = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 500000 });
assert(ytdHighIncome.grossTaxILS > ytdZero.grossTaxILS,
  'Bracket <2yr: priorGainILS=500k produces higher grossTaxILS than priorGainILS=0');
// With ₪500k prior, the lot lands in the 35% bracket (₪301k–₪560k)
// taxOnTotal(₪536,500) = bracketTax up to 35% bracket; taxOnPrior(₪500k)=35% range
// marginal rate should be 35%, so grossTaxILS ≈ 36500×0.35 = ₪12,775
assert(near(ytdHighIncome.grossTaxILS, 12775, 50),
  'Bracket <2yr, priorGainILS=500k: grossTaxILS ≈ ₪12,775 (35% marginal)');

console.log('\n--- YTD income context: bracket mode ≥2yr ordinary portion shifts upward ---');
// grossUSD=10000, benefitUSD=6000 (ordinary), appreciation=4000 (CG)
// priorGainILS=0: ordinaryILS=6000×3.65=₪21,900 → 10% bracket → grossTaxILS ≈ ₪2,190
const ytdGe2Zero = calculateLotTax({ grossUSD: 10000, benefitUSD: 6000, yearsSinceVesting: 2.5, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
// priorGainILS=500000: same ordinary portion taxed at 35% marginal
const ytdGe2High = calculateLotTax({ grossUSD: 10000, benefitUSD: 6000, yearsSinceVesting: 2.5, mode: 'bracket',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 500000 });
assert(ytdGe2High.grossTaxILS > ytdGe2Zero.grossTaxILS,
  'Bracket ≥2yr: priorGainILS=500k raises ordinary grossTaxILS above priorGainILS=0');
// CG portion is unaffected by priorGainILS — cgTaxUSD should be the same in both
assert(near(ytdGe2High.cgTaxUSD, ytdGe2Zero.cgTaxUSD, 0.01),
  'Bracket ≥2yr: cgTaxUSD is unchanged by priorGainILS');

console.log('\n--- YTD income context: flat mode ignores priorGainILS (regression guard) ---');
// In flat mode, priorGainILS must have zero effect on the result
const flatNoYtd = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 0 });
const flatWithYtd = calculateLotTax({ grossUSD: 10000, benefitUSD: 10000, yearsSinceVesting: 1, mode: 'flat',
  flatOrdinaryRate: 0.47, capitalGainsRate: 0.25, capitalGainsSurtax: false,
  usdToILS: 3.65, priorGainILS: 500000 });
assert(near(flatNoYtd.taxUSD, flatWithYtd.taxUSD, 0.01),
  'Flat mode: priorGainILS=500k does not change taxUSD (regression guard)');

console.log('\n--- bracketIndexFor ---');
// Boundaries are inclusive on the upper edge: 84120 is in bracket 0, 84121 in bracket 1.
assert(bracketIndexFor(0, IL_BRACKETS_2026) === 0, '₪0 → bracket 0 (10%)');
assert(bracketIndexFor(50000, IL_BRACKETS_2026) === 0, '₪50k → bracket 0 (10%)');
assert(bracketIndexFor(84120, IL_BRACKETS_2026) === 0, '₪84,120 (exact boundary) → bracket 0');
assert(bracketIndexFor(84121, IL_BRACKETS_2026) === 1, '₪84,121 → bracket 1 (14%)');
assert(bracketIndexFor(100000, IL_BRACKETS_2026) === 1, '₪100k → bracket 1 (14%)');
assert(bracketIndexFor(300000, IL_BRACKETS_2026) === 3, '₪300k → bracket 3 (31%)');
assert(bracketIndexFor(800000, IL_BRACKETS_2026) === 6, '₪800k → bracket 6 (50%, above ₪721,560)');
assert(bracketIndexFor(1e9, IL_BRACKETS_2026) === 6, 'very large → bracket 6 (top)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
