// calculator.js
// Israeli Section 102 Income Track tax rules:
//   ≥2yr: ordinary income tax on min(grossUSD, benefitUSD) + 25% CG on max(0, grossUSD - benefitUSD)
//   <2yr: ordinary income tax on entire gross proceeds

var IL_BRACKETS_2026 = [
  { limit: 84120,    rate: 0.10 },
  { limit: 120720,   rate: 0.14 },
  { limit: 228000,   rate: 0.20 },
  { limit: 301200,   rate: 0.31 },
  { limit: 560280,   rate: 0.35 },
  { limit: 721560,   rate: 0.47 },
  { limit: Infinity, rate: 0.50 }, // 47% + 3% surtax (Section 121b)
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

// Returns { taxUSD, ordinaryTaxUSD, cgTaxUSD, grossTaxILS, gainILS, effectiveRate, mode }.
// grossTaxILS / gainILS are only present in bracket mode (for resident credit calculation).
// In bracket mode, grossTaxILS covers the ordinary-income bracket tax only; cgTaxUSD is always flat.
// The resident credit is applied at the total level in the recalculation loop, not here.
function calculateLotTax({
  grossUSD,
  benefitUSD,         // FMV × qty (ordinary income base for ≥2yr)
  yearsSinceVesting,
  mode,               // 'flat' | 'bracket'
  flatOrdinaryRate,
  capitalGainsRate,
  capitalGainsSurtax,
  usdToILS,
  priorGainILS,       // cumulative ordinary income ILS already taxed (bracket mode)
}) {
  if (grossUSD <= 0) {
    return { taxUSD: 0, ordinaryTaxUSD: 0, cgTaxUSD: 0, gainILS: 0, grossTaxILS: 0, effectiveRate: 0, mode: 'zero' };
  }

  const cgRate = capitalGainsRate + (capitalGainsSurtax ? 0.03 : 0);

  if (yearsSinceVesting >= 2) {
    // Ordinary income on the FMV benefit (capped at gross if stock fell below FMV)
    const ordinaryBase = Math.min(grossUSD, benefitUSD);
    const cgBase = Math.max(0, grossUSD - benefitUSD);
    const cgTaxUSD = cgBase * cgRate;

    if (mode === 'flat') {
      // §121b surtax applies to all income above ₪721,560/yr, not just capital gains.
      // In flat mode we add it explicitly; bracket mode already encodes it in the 50% top bracket.
      const ordinaryTaxUSD = ordinaryBase * (flatOrdinaryRate + (capitalGainsSurtax ? 0.03 : 0));
      const taxUSD = ordinaryTaxUSD + cgTaxUSD;
      return { taxUSD, ordinaryTaxUSD, cgTaxUSD, effectiveRate: taxUSD / grossUSD, mode: 'capital-gains' };
    }

    // Bracket mode: marginal brackets on ordinary portion only; CG is always flat
    const ordinaryILS = ordinaryBase * usdToILS;
    const grossTaxILS = bracketTaxForAmount(priorGainILS + ordinaryILS, IL_BRACKETS_2026)
                      - bracketTaxForAmount(priorGainILS, IL_BRACKETS_2026);
    const ordinaryTaxUSD = grossTaxILS / usdToILS;
    const taxUSD = ordinaryTaxUSD + cgTaxUSD;
    return { taxUSD, ordinaryTaxUSD, cgTaxUSD, grossTaxILS, gainILS: ordinaryILS, effectiveRate: taxUSD / grossUSD, mode: 'capital-gains' };
  }

  // <2yr: ordinary income tax on entire gross proceeds
  if (mode === 'flat') {
    // §121b surtax applies to all income above ₪721,560/yr, not just capital gains.
    // In flat mode we add it explicitly; bracket mode already encodes it in the 50% top bracket.
    const effectiveOrdinaryRate = flatOrdinaryRate + (capitalGainsSurtax ? 0.03 : 0);
    const taxUSD = grossUSD * effectiveOrdinaryRate;
    return { taxUSD, ordinaryTaxUSD: taxUSD, cgTaxUSD: 0, effectiveRate: effectiveOrdinaryRate, mode: 'flat-ordinary' };
  }

  // <2yr bracket mode
  const grossILS = grossUSD * usdToILS;
  const grossTaxILS = bracketTaxForAmount(priorGainILS + grossILS, IL_BRACKETS_2026)
                    - bracketTaxForAmount(priorGainILS, IL_BRACKETS_2026);
  const taxUSD = grossTaxILS / usdToILS;
  return { taxUSD, ordinaryTaxUSD: taxUSD, cgTaxUSD: 0, grossTaxILS, gainILS: grossILS, effectiveRate: grossUSD > 0 ? taxUSD / grossUSD : 0, mode: 'bracket' };
}
