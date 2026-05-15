// Run: node tests/test-exchange-rate.js
'use strict';

const h = require('./_harness');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.error(`  ✗ ${msg}`); failed++; }
}

// Load all content scripts. content.js side-effects (MutationObserver, tryInject)
// are benign when there's no table or stockplanjson in the DOM.
function setupAndLoad(fetchHandler) {
  h.setupDOM({ stockplanJson: null, rows: [] });
  h.mockFetch(fetchHandler || (() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })));
  h.loadContentScripts();
}

// Flush pending Promise microtasks by awaiting a resolved promise N times.
// Each await yields to the microtask queue once.
async function flushMicrotasks(n = 5) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

(async () => {
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- setManualExchangeRate: stores entry with manualOverride=true ---');
  // ─────────────────────────────────────────────────────────────────────────────

  setupAndLoad();

  const entry = h.getGlobal('setManualExchangeRate')(4.00);

  assert(entry.rate === 4.00, 'manual override: returned entry.rate = 4.00');
  assert(entry.manualOverride === true, 'manual override: returned entry.manualOverride = true');
  assert(entry.source === 'manual', 'manual override: returned entry.source = "manual"');

  const storeAfterSet = h.getLocalStore();
  assert(storeAfterSet.exchangeRateCache && storeAfterSet.exchangeRateCache.rate === 4.00,
         'manual override: local store contains rate 4.00');
  assert(storeAfterSet.exchangeRateCache.manualOverride === true,
         'manual override: local store manualOverride = true');

  h.teardown();

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- getExchangeRate: manualOverride = true skips fetch ---');
  // ─────────────────────────────────────────────────────────────────────────────

  let fetchCalled = false;
  setupAndLoad(({ url }) => {
    fetchCalled = true;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });

  h.getGlobal('chrome').storage.local.set({
    exchangeRateCache: { rate: 4.10, source: 'manual', fetchedAt: Date.now(), manualOverride: true },
  });

  const rateMO = await h.getGlobal('getExchangeRate')();
  assert(!fetchCalled, 'manual override: fetch not called when manualOverride=true');
  assert(rateMO && rateMO.rate === 4.10, 'manual override: resolved rate = 4.10');

  h.teardown();

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- getExchangeRate: fresh cache (< 24h) skips fetch ---');
  // ─────────────────────────────────────────────────────────────────────────────

  fetchCalled = false;
  setupAndLoad(({ url }) => {
    fetchCalled = true;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });

  h.getGlobal('chrome').storage.local.set({
    exchangeRateCache: {
      rate: 3.72,
      source: 'Bank of Israel',
      fetchedAt: Date.now() - 60 * 60 * 1000, // 1h ago — fresh
      manualOverride: false,
    },
  });

  const rateFresh = await h.getGlobal('getExchangeRate')();
  assert(!fetchCalled, 'fresh cache: fetch not called when cache < 24h old');
  assert(rateFresh && rateFresh.rate === 3.72, 'fresh cache: resolved rate = 3.72 (from cache)');

  h.teardown();

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- getExchangeRate: stale cache (> 24h) triggers BOI fetch ---');
  // ─────────────────────────────────────────────────────────────────────────────

  let boiCalled = false;
  setupAndLoad(({ url }) => {
    if (url.includes('boi.org.il')) {
      boiCalled = true;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({
          dataSets: [{ series: { '0:0:0': { observations: { '0': [3.78] } } } }],
        }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });

  h.getGlobal('chrome').storage.local.set({
    exchangeRateCache: {
      rate: 3.50,
      source: 'old',
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000, // 25h ago — stale
      manualOverride: false,
    },
  });

  const rateStale = await h.getGlobal('getExchangeRate')();
  await flushMicrotasks(10);

  assert(boiCalled, 'stale cache: BOI fetch triggered when cache > 24h old');
  assert(rateStale && rateStale.rate === 3.78, 'stale cache: resolved fresh rate = 3.78');
  assert(rateStale && rateStale.source === 'Bank of Israel', 'stale cache: source = Bank of Israel');

  const storeStale = h.getLocalStore();
  assert(storeStale.exchangeRateCache && storeStale.exchangeRateCache.rate === 3.78,
         'stale cache: local store updated with fresh rate 3.78');

  h.teardown();

  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- BOI failure falls back to open.er-api.com ---');
  // ─────────────────────────────────────────────────────────────────────────────

  let boiFailed = false, fallbackCalled = false;
  setupAndLoad(({ url }) => {
    if (url.includes('boi.org.il')) {
      boiFailed = true;
      return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) });
    }
    if (url.includes('er-api.com')) {
      fallbackCalled = true;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ rates: { ILS: 3.81 } }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });

  const rateFallback = await h.getGlobal('getExchangeRate')();
  await flushMicrotasks(10);

  assert(boiFailed,      'BOI fallback: BOI URL attempted (and failed)');
  assert(fallbackCalled, 'BOI fallback: er-api.com fallback URL attempted');
  assert(rateFallback && rateFallback.rate === 3.81,
         'BOI fallback: resolved rate = 3.81 from er-api.com');
  assert(rateFallback && rateFallback.source === 'open.er-api.com',
         'BOI fallback: source = open.er-api.com');

  const storeFallback = h.getLocalStore();
  assert(storeFallback.exchangeRateCache && storeFallback.exchangeRateCache.rate === 3.81,
         'BOI fallback: local store updated with fallback rate 3.81');

  h.teardown();

  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
