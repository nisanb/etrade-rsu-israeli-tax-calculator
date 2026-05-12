// calculator.js

var IL_BRACKETS_2026 = [
  { limit: 84120,    rate: 0.10 },
  { limit: 120720,   rate: 0.14 },
  { limit: 228000,   rate: 0.20 },
  { limit: 301200,   rate: 0.31 },
  { limit: 560280,   rate: 0.35 },
  { limit: 721560,   rate: 0.47 },
  { limit: Infinity, rate: 0.50 }, // 47% + built-in 3% surtax (Section 121b)
];

function bracketTaxForAmount(amountILS, brackets) {
  let tax = 0;
  let prev = 0;
  for (const { limit, rate } of brackets) {
    if (amountILS <= prev) break;
    const slice = Math.min(amountILS, limit) - prev;
    tax += slice * rate;
    prev = limit;
  }
  return tax;
}

// Returns per-lot tax result.
// In bracket mode, grossTaxILS is the marginal bracket tax for this lot only.
// The resident credit is applied at the total level in the recalculation loop, not here.
function calculateLotTax({
  gainUSD,
  yearsSinceVesting,
  mode,
  flatOrdinaryRate,
  capitalGainsRate,
  capitalGainsSurtax,
  usdToILS,
  residentCreditILS, // not used here; applied at total level in bracket mode
  priorGainILS,
}) {
  if (gainUSD <= 0) {
    return { taxUSD: 0, grossTaxILS: 0, gainILS: 0, effectiveRate: 0, mode: 'zero' };
  }

  if (yearsSinceVesting >= 2) {
    const rate = capitalGainsRate + (capitalGainsSurtax ? 0.03 : 0);
    return { taxUSD: gainUSD * rate, effectiveRate: rate, mode: 'capital-gains' };
  }

  if (mode === 'flat') {
    return { taxUSD: gainUSD * flatOrdinaryRate, effectiveRate: flatOrdinaryRate, mode: 'flat-ordinary' };
  }

  // Bracket mode: marginal tax from priorGainILS to priorGainILS + gainILS
  const gainILS = gainUSD * usdToILS;
  const taxOnPrior = bracketTaxForAmount(priorGainILS, IL_BRACKETS_2026);
  const taxOnTotal = bracketTaxForAmount(priorGainILS + gainILS, IL_BRACKETS_2026);
  const grossTaxILS = taxOnTotal - taxOnPrior;
  const effectiveRate = gainILS > 0 ? grossTaxILS / gainILS : 0;
  return { taxUSD: grossTaxILS / usdToILS, grossTaxILS, gainILS, effectiveRate, mode: 'bracket' };
}
