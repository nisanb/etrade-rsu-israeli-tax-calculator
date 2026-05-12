// exchange-rate.js

const BOI_URL = 'https://edge.boi.org.il/FusionEdgesFiles/sdmx/2.1/data/DF_REPRESENTATIVE_RATE/1.0/?c[CURRENCY]=USD&lastNObservations=1&format=sdmx-json';
const FALLBACK_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_KEY = 'exchangeRateCache';
const TTL_MS = 24 * 60 * 60 * 1000;

async function _fetchBOI() {
  const res = await fetch(BOI_URL);
  if (!res.ok) throw new Error(`BOI HTTP ${res.status}`);
  const json = await res.json();
  const obs = json.dataSets[0].series['0:0:0'].observations;
  const key = Object.keys(obs).sort((a, b) => parseInt(a) - parseInt(b)).pop();
  const rate = parseFloat(obs[key][0]);
  if (isNaN(rate) || rate <= 0) throw new Error('BOI rate invalid');
  return rate;
}

async function _fetchFallback() {
  const res = await fetch(FALLBACK_URL);
  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
  const json = await res.json();
  const rate = parseFloat(json.rates && json.rates.ILS);
  if (isNaN(rate) || rate <= 0) throw new Error('Fallback ILS rate invalid');
  return rate;
}

async function _fetchFresh() {
  try {
    const rate = await _fetchBOI();
    console.log('[IL Tax] Exchange rate (BOI):', rate);
    return { rate, source: 'Bank of Israel', fetchedAt: Date.now(), manualOverride: false };
  } catch (e) {
    console.warn('[IL Tax] BOI failed:', e.message);
  }
  try {
    const rate = await _fetchFallback();
    console.log('[IL Tax] Exchange rate (fallback):', rate);
    return { rate, source: 'open.er-api.com', fetchedAt: Date.now(), manualOverride: false };
  } catch (e) {
    console.error('[IL Tax] Both rate sources failed:', e.message);
    return null;
  }
}

async function getExchangeRate() {
  return new Promise(resolve => {
    chrome.storage.local.get(CACHE_KEY, async (stored) => {
      const cached = stored[CACHE_KEY];
      if (cached && cached.manualOverride) { resolve(cached); return; }
      if (cached && (Date.now() - cached.fetchedAt) < TTL_MS) { resolve(cached); return; }
      const fresh = await _fetchFresh();
      if (fresh) chrome.storage.local.set({ [CACHE_KEY]: fresh });
      resolve(fresh || cached || { rate: 3.65, source: 'default', fetchedAt: 0, manualOverride: false });
    });
  });
}

async function refreshExchangeRate() {
  const fresh = await _fetchFresh();
  if (fresh) chrome.storage.local.set({ [CACHE_KEY]: fresh });
  return fresh;
}

function setManualExchangeRate(rate) {
  const entry = { rate, source: 'manual', fetchedAt: Date.now(), manualOverride: true };
  chrome.storage.local.set({ [CACHE_KEY]: entry });
  return entry;
}
