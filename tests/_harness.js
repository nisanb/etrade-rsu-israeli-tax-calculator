// tests/_harness.js
// Shared JSDOM harness for Tier-2 integration tests.
//
// Usage:
//   const h = require('./_harness');
//   h.setupDOM({ stockplanJson, rows });
//   h.loadContentScripts();
//   // ... run test ...
//   h.teardown();
//
// Each setupDOM() + loadContentScripts() pair creates a fresh JSDOM window and a
// fresh Node.js VM context, so top-level `const`/`let` declarations in the content
// scripts don't collide across test blocks.
//
// Time control: setInterval is monkey-patched to record intervals.
// Call h.tick(ms) to advance time and fire intervals that are due.
// We chose hand-rolled time control over @sinonjs/fake-timers to stay single-dep (jsdom only).

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

// ─── Internal state ─────────────────────────────────────────────────────────

let _ctx  = null;  // active vm.Context (created per setupDOM call)
let _dom  = null;

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * Build a fresh JSDOM environment and VM execution context.
 *
 * @param {object} opts
 * @param {object|null} opts.stockplanJson  Parsed JS object to embed as #stockplanjson content.
 *                                          Pass null to omit the div (triggers parse failure).
 * @param {Array}       opts.rows           Array of row descriptors:
 *                                          { vestDate, fmv, qty }
 *                                          vestDate: 'MM/DD/YYYY'
 *                                          fmv: number (e.g. 85.20)
 *                                          qty: number (initial input value, default 0)
 */
function setupDOM({ stockplanJson = null, rows = [] } = {}) {
  teardown(); // ensure no leftover state

  const tableHtml = _buildTableHtml(rows);
  const stockplanDiv = stockplanJson != null
    ? `<div id="stockplanjson" style="display:none">${JSON.stringify(stockplanJson)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head></head>
<body>
  <div id="application">
    ${stockplanDiv}
    ${tableHtml}
  </div>
</body>
</html>`;

  _dom = new JSDOM(html, {
    url: 'https://us.etrade.com/etx/sp/stockplan',
    pretendToBeVisual: true,
  });

  const { window } = _dom;

  const messageListeners = [];
  const intervals = [];
  let intervalIdCounter = 1;
  let fetchHandler = null;
  const syncStore  = {};
  const localStore = {};

  // Hand-rolled time tracking — records setInterval registrations so tick() can fire them.
  // virtualTime starts at 0 and is advanced by tick(). We use a separate virtual clock
  // (not Date.now()) so that multiple tick() calls within the same test block accumulate
  // correctly regardless of how much real time has elapsed.
  let virtualTime = 0;
  const mockSetInterval = (fn, delay) => {
    const id = intervalIdCounter++;
    intervals.push({ id, fn, delay, lastFiredAt: virtualTime });
    return id;
  };
  const mockClearInterval = id => {
    const idx = intervals.findIndex(iv => iv.id === id);
    if (idx >= 0) intervals.splice(idx, 1);
  };

  const chromeMock = _buildChromeMock(syncStore, localStore, messageListeners);

  // The VM context sandbox: everything the content scripts may reference.
  // Each script load gets this same context object, so symbols declared in one
  // script (via `var` or `function`) are available to subsequent scripts.
  // `const`/`let` are block-scoped to each Script run, but because they are at
  // the top level of a Script run in a Context, they are set as properties on the
  // context's global-like object in V8 — so they ARE visible to later scripts in
  // the same context.
  const sandbox = {
    // Browser-like globals
    window,
    document: window.document,
    location: window.location,
    navigator: window.navigator,
    console,
    MutationObserver: window.MutationObserver,
    Event:            window.Event,
    CustomEvent:      window.CustomEvent,
    requestAnimationFrame: cb => { cb(0); return 0; },
    setInterval:  mockSetInterval,
    clearInterval: mockClearInterval,
    setTimeout:   (fn, ms) => { fn(); return 0; }, // fire immediately for simplicity
    clearTimeout: () => {},
    fetch: (...args) => {
      if (!fetchHandler) throw new Error('fetch called but no mockFetch() handler installed');
      const url = typeof args[0] === 'string' ? args[0] : args[0].url;
      const method = (args[1] && args[1].method) || 'GET';
      return fetchHandler({ url, method });
    },
    chrome: chromeMock,
    // Will be populated by content scripts via var/function declarations:
    // IL_BRACKETS_2026, bracketTaxForAmount, calculateLotTax,
    // parseStockPlanJson, parseStockPlanFromPage,
    // injectColumns, updateRowCells, updateStatusCell, updateTotals, injectParseFailureBanner,
    // getExchangeRate, refreshExchangeRate, setManualExchangeRate,
    // recalculate, tryInject, _startQtyPoller, settings, injectionResult, parsedData
  };

  vm.createContext(sandbox);

  // Store references on _ctx for helper access
  _ctx = {
    sandbox,
    window,
    intervals,
    syncStore,
    localStore,
    messageListeners,
    setFetchHandler: fn => { fetchHandler = fn; },
    getVirtualTime: () => virtualTime,
    advanceVirtualTime: ms => { virtualTime += ms; },
  };
}

/**
 * Load the five content scripts in manifest order into the current VM context.
 * Must be called after setupDOM().
 */
function loadContentScripts() {
  _assertCtx();
  const scripts = ['calculator.js', 'parser.js', 'injector.js', 'exchange-rate.js', 'content.js'];
  for (const name of scripts) {
    const code = fs.readFileSync(path.join(ROOT, name), 'utf8');
    vm.runInContext(code, _ctx.sandbox, { filename: name });
  }
}

/**
 * Advance the virtual clock by `ms` milliseconds and fire any registered intervals that are due.
 * Uses a monotonic virtual clock (not Date.now()) so multiple tick() calls accumulate correctly.
 */
function tick(ms) {
  _assertCtx();
  _ctx.advanceVirtualTime(ms);
  const now = _ctx.getVirtualTime();
  for (const iv of _ctx.intervals) {
    const due = Math.floor((now - iv.lastFiredAt) / iv.delay);
    if (due > 0) {
      iv.lastFiredAt += due * iv.delay;
      iv.fn();
    }
  }
}

/**
 * Install a fetch mock. Handler: ({url, method}) => Promise<{ok, status, json}>
 */
function mockFetch(handler) {
  _assertCtx();
  _ctx.setFetchHandler(handler);
}

/**
 * Emit a Chrome runtime message to all registered onMessage listeners.
 */
function emitMessage(msg) {
  _assertCtx();
  for (const fn of _ctx.messageListeners) {
    fn(msg, {}, () => {});
  }
}

/**
 * Simulate a user editing the qty input on a given row handle (fires input event).
 * The handle is the DOM node returned from the injected handles array.
 */
function editQty(qtyInput, value) {
  _assertCtx();
  qtyInput.value = String(value);
  qtyInput.dispatchEvent(new _ctx.window.Event('input', { bubbles: true }));
}

/**
 * Simulate E*TRADE's "Select All" button: sets input.value programmatically
 * WITHOUT firing an event. The qty poller should detect this on the next tick.
 */
function selectAll(qtyInputs, value) {
  _assertCtx();
  for (const input of qtyInputs) {
    input.value = String(value);
  }
}

/** Return a copy of the chrome.storage.sync state. */
function getSyncStore() {
  _assertCtx();
  return { ..._ctx.syncStore };
}

/** Return a copy of the chrome.storage.local state. */
function getLocalStore() {
  _assertCtx();
  return { ..._ctx.localStore };
}

/**
 * Return the active JSDOM document (shortcut so tests don't need to keep a reference
 * to the sandbox themselves).
 */
function getDocument() {
  _assertCtx();
  return _ctx.window.document;
}

/**
 * Return the active JSDOM window.
 */
function getWindow() {
  _assertCtx();
  return _ctx.window;
}

/**
 * Return a property that a content script wrote into the VM context sandbox.
 * Use this to reach globals like `settings`, `injectionResult`, `recalculate`, etc.
 */
function getGlobal(name) {
  _assertCtx();
  return _ctx.sandbox[name];
}

/**
 * Call a function that lives in the VM context (e.g. recalculate).
 */
function callGlobal(name, ...args) {
  _assertCtx();
  const fn = _ctx.sandbox[name];
  if (typeof fn !== 'function') throw new Error(`No function "${name}" in VM context`);
  return fn(...args);
}

/**
 * Destroy the current context. Safe to call multiple times.
 */
function teardown() {
  _ctx = null;
  _dom = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _assertCtx() {
  if (!_ctx) throw new Error('Call setupDOM() before using harness helpers');
}

function _buildTableHtml(rows) {
  const bodyRows = rows.map(({ vestDate, fmv, qty = 0 }) => `
    <tr>
      <td>Type</td>
      <td>${vestDate}</td>
      <td>Symbol</td>
      <td>$${fmv.toFixed(2)}</td>
      <td><input class="form-control" placeholder="0" type="number" value="${qty}" /></td>
      <td>$0</td>
    </tr>`).join('');

  return `
    <table class="table-presentation table-striped">
      <thead>
        <tr>
          <th>Type</th><th>Vest Date</th><th>Symbol</th><th>FMV</th><th>Qty</th><th>Proceeds</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
}

function _buildChromeMock(syncStore, localStore, messageListeners) {
  return {
    storage: {
      sync: {
        get: (defaults, cb) => {
          // Mirror real Chrome API: merge defaults with stored values (stored wins).
          const merged = typeof defaults === 'object' && !Array.isArray(defaults)
            ? { ...defaults, ...syncStore }
            : { ...syncStore };
          cb(merged);
        },
        set: (obj, cb) => {
          Object.assign(syncStore, obj);
          if (cb) cb();
        },
      },
      local: {
        get: (key, cb) => {
          if (typeof key === 'string') {
            cb({ [key]: localStore[key] });
          } else if (Array.isArray(key)) {
            const result = {};
            for (const k of key) result[k] = localStore[k];
            cb(result);
          } else {
            cb({ ...localStore });
          }
        },
        set: (obj, cb) => {
          Object.assign(localStore, obj);
          if (cb) cb();
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: fn => { messageListeners.push(fn); },
      },
      getManifest: () => ({ version: '1.2.0' }),
    },
    tabs: {
      query: (_, cb) => cb([{ id: 1 }]),
      sendMessage: () => {},
      create: () => {},
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

module.exports = {
  setupDOM,
  loadContentScripts,
  tick,
  mockFetch,
  emitMessage,
  editQty,
  selectAll,
  getSyncStore,
  getLocalStore,
  getDocument,
  getWindow,
  getGlobal,
  callGlobal,
  teardown,
};
