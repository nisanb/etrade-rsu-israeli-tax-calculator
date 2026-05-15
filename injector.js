// injector.js
const SELLABLE_TABLE_SELECTOR = 'table.table-presentation.table-striped';
const QTY_INPUT_SELECTOR = 'input.form-control[placeholder="0"], input.form-control, input[type="number"]';
const IL_CLASS = 'il-tax-col';
const STYLE_HEADER = 'background:#e8f5e9;color:#1b5e20;padding:5px 8px;font-size:11px;white-space:nowrap;border-top:2px solid #4caf50;';
const STYLE_CELL   = 'background:#f1f8e9;padding:5px 8px;font-size:11px;';
const STYLE_TOTALS_ROW = 'background:#e8f5e9;font-weight:bold;';

// ─── Rich popup (Octavian-style) ─────────────────────────────────────────────

let _popupEl = null;
let _ignoreNextClose = false;

const POPUP_CSS = `
#il-tax-popup{position:fixed;z-index:2147483647;display:none;background:#fff;
  border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.22);border:1px solid #ddd;
  width:390px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  font-size:13px;color:#333;overflow:hidden}
#il-tax-popup *{box-sizing:border-box;margin:0;padding:0}
.ilp-hdr{background:#1b5e20;color:#fff;padding:11px 16px;display:flex;
  justify-content:space-between;align-items:center}
.ilp-title{font-size:14px;font-weight:700;letter-spacing:.2px}
.ilp-acts{display:flex;gap:6px}
.ilp-btn{background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.3);
  border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.ilp-btn:hover{background:rgba(255,255,255,.32)}
.ilp-vest{padding:12px 16px;background:#f8fdf8;border-bottom:1px solid #e8f5e9}
.ilp-vest-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:4px}
.ilp-vest-date{font-size:12px;color:#666}
.ilp-badge{font-size:12px;font-weight:700;padding:2px 8px;border-radius:20px}
.ilp-badge-g{background:#e8f5e9;color:#2e7d32}
.ilp-badge-o{background:#fff3e0;color:#e65100}
.ilp-vest-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
.ilp-k{font-size:11px;color:#888}
.ilp-v{font-size:13px;font-weight:600;color:#222}
.ilp-gross{font-size:13px;color:#555}
.ilp-gross strong{font-size:15px;color:#1b5e20}
.ilp-sub{font-size:12px;color:#888}
.ilp-bd{padding:12px 16px}
.ilp-sec{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#777;margin-bottom:10px}
.ilp-tr{margin-bottom:10px}
.ilp-tr-hd{display:flex;align-items:baseline;gap:6px}
.ilp-tr-name{font-size:13px;font-weight:600;color:#333}
.ilp-tr-hint{font-size:11px;color:#aaa}
.ilp-tr-basis{font-size:11px;color:#999;margin:2px 0}
.ilp-tr-tax{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#666}
.ilp-tr-amt{font-size:13px;font-weight:700;color:#c62828}
.ilp-tr-ils{font-size:11px;font-weight:400;color:#e57373}
.ilp-div{border:none;border-top:1px solid #eee;margin:8px 0}
.ilp-total{display:flex;justify-content:space-between;align-items:center}
.ilp-total-lbl{font-size:13px;font-weight:700;color:#333}
.ilp-total-amt{font-size:15px;font-weight:700;color:#b71c1c}
.ilp-net{background:#f1f8e9;padding:12px 16px;border-top:1px solid #e8f5e9}
.ilp-net-lbl{font-size:11px;color:#777;margin-bottom:4px}
.ilp-net-val{font-size:22px;font-weight:700;color:#2e7d32}
.ilp-net-ils{font-size:13px;color:#388e3c;margin-top:2px}
.ilp-bar-sec{padding:10px 16px 14px;border-top:1px solid #f0f0f0}
.ilp-bar{display:flex;height:24px;border-radius:12px;overflow:hidden;margin-bottom:5px}
.ilp-bar-tax{background:#ef5350;display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:11px;font-weight:700;transition:width .4s ease;min-width:0}
.ilp-bar-net{background:#43a047;display:flex;align-items:center;justify-content:center;
  color:#fff;font-size:11px;font-weight:700;transition:width .4s ease;min-width:0}
.ilp-bar-lbls{display:flex;justify-content:space-between;font-size:11px;font-weight:600}
.ilp-lbl-tax{color:#ef5350}
.ilp-lbl-net{color:#43a047}
.il-tax-info{font-size:10px;color:#7b8fa6;margin-left:4px;vertical-align:super;cursor:pointer;}
`;

function _ensurePopup() {
  if (_popupEl) return;

  const style = document.createElement('style');
  style.textContent = POPUP_CSS;
  document.head.appendChild(style);

  _popupEl = document.createElement('div');
  _popupEl.id = 'il-tax-popup';
  document.body.appendChild(_popupEl);

  // Open popup when clicking an IL Tax cell
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-il-tip-data]');
    if (!target || !target.dataset.ilTipData) return;
    _ignoreNextClose = true;
    try { _renderAndShowPopup(JSON.parse(target.dataset.ilTipData), target.getBoundingClientRect()); } catch (_) {}
  }, true);

  // Close on outside click
  document.addEventListener('click', () => {
    if (_ignoreNextClose) { _ignoreNextClose = false; return; }
    if (_popupEl) _popupEl.style.display = 'none';
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _popupEl) _popupEl.style.display = 'none';
  });
}

function _renderAndShowPopup(d, triggerRect) {
  const isILS = d.currency === 'ILS';
  const fu  = n => '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  const fil = n => '₪' + Math.abs(Math.round(n * d.usdToILS)).toLocaleString('en-US');
  // fp = primary currency, fs = secondary (dimmed)
  const fp  = n => isILS ? fil(n) : fu(n);
  const fs  = n => isILS ? fu(n) : fil(n);

  const is2yr = d.yearsSinceVesting >= 2;
  const netUSD = d.grossUSD - d.taxUSD;
  const ordinaryBase = Math.min(d.grossUSD, d.benefitUSD);
  const cgBase = Math.max(0, d.grossUSD - d.benefitUSD);
  const taxPct = (d.taxUSD / d.grossUSD * 100).toFixed(1);
  const netPct = (100 - parseFloat(taxPct)).toFixed(1);
  const sellPerShare = d.qty > 0 ? d.grossUSD / d.qty : 0;
  const ordPct = (d.ordinaryRate * 100).toFixed(0);
  const cgPct  = (d.cgRate * 100).toFixed(0);

  let taxRows;
  if (is2yr) {
    const capitalLossUSD = d.capitalLossUSD || 0;
    const lossRow = capitalLossUSD > 0 ? `
      <div class="ilp-tr">
        <div class="ilp-tr-hd"><span class="ilp-tr-name">Capital loss</span><span class="ilp-tr-hint">FMV − sell</span></div>
        <div class="ilp-tr-tax"><span>Reportable; offsets future gains</span>
          <span class="ilp-tr-amt" style="color:#7b8fa6;">−${fp(capitalLossUSD)} <span class="ilp-tr-ils">/ −${fs(capitalLossUSD)}</span></span></div>
      </div>` : '';
    taxRows = `
      <div class="ilp-tr">
        <div class="ilp-tr-hd"><span class="ilp-tr-name">Ordinary income</span><span class="ilp-tr-hint">FMV × qty</span></div>
        <div class="ilp-tr-basis">basis: ${fp(ordinaryBase)} <span class="ilp-tr-ils">/ ${fs(ordinaryBase)}</span></div>
        <div class="ilp-tr-tax"><span>Tax @ ${ordPct}%</span>
          <span class="ilp-tr-amt">−${fp(d.ordinaryTaxUSD)} <span class="ilp-tr-ils">/ −${fs(d.ordinaryTaxUSD)}</span></span></div>
      </div>
      <div class="ilp-tr">
        <div class="ilp-tr-hd"><span class="ilp-tr-name">Capital gain</span><span class="ilp-tr-hint">above FMV</span></div>
        <div class="ilp-tr-basis">basis: ${fp(cgBase)} <span class="ilp-tr-ils">/ ${fs(cgBase)}</span></div>
        <div class="ilp-tr-tax"><span>Tax @ ${cgPct}%</span>
          <span class="ilp-tr-amt">−${fp(d.cgTaxUSD)} <span class="ilp-tr-ils">/ −${fs(d.cgTaxUSD)}</span></span></div>
      </div>
      ${lossRow}`;
  } else {
    taxRows = `
      <div class="ilp-tr">
        <div class="ilp-tr-hd"><span class="ilp-tr-name">Ordinary income</span><span class="ilp-tr-hint">entire gross, &lt;2yr</span></div>
        <div class="ilp-tr-basis">basis: ${fp(d.grossUSD)} <span class="ilp-tr-ils">/ ${fs(d.grossUSD)}</span></div>
        <div class="ilp-tr-tax"><span>Tax @ ${ordPct}%</span>
          <span class="ilp-tr-amt">−${fp(d.taxUSD)} <span class="ilp-tr-ils">/ −${fs(d.taxUSD)}</span></span></div>
      </div>`;
  }

  _popupEl.innerHTML = `
    <div class="ilp-hdr">
      <span class="ilp-title">IL Tax Breakdown</span>
      <div class="ilp-acts">
        <button class="ilp-btn" id="ilp-copy">📋 Copy</button>
        <button class="ilp-btn" id="ilp-close">✕</button>
      </div>
    </div>
    <div class="ilp-vest">
      <div class="ilp-vest-top">
        <div class="ilp-vest-date">
          <div>Vest date: ${d.dateText}</div>
          ${d.grantDateText ? `<div>Grant date: ${d.grantDateText} · ${d.yearsSinceVesting.toFixed(1)} yrs ${is2yr ? '✓≥2yr' : '✗&lt;2yr'}</div>` : `<div>${d.yearsSinceVesting.toFixed(1)} yrs from vest</div>`}
        </div>
        <span class="ilp-badge ${is2yr ? 'ilp-badge-g' : 'ilp-badge-o'}">${is2yr ? '✓ ≥2yr' : '✗ &lt;2yr'}</span>
      </div>
      <div class="ilp-vest-grid">
        <div><div class="ilp-k">FMV at vest</div><div class="ilp-v">$${d.fmvAtVesting.toFixed(2)}/sh</div></div>
        <div><div class="ilp-k">Sell price</div><div class="ilp-v">$${sellPerShare.toFixed(2)}/sh</div></div>
        <div><div class="ilp-k">Quantity</div><div class="ilp-v">${d.qty} shares</div></div>
        <div><div class="ilp-k">USD/ILS rate</div><div class="ilp-v">₪${d.usdToILS}</div></div>
      </div>
      <div class="ilp-gross">Gross proceeds: <strong>${fp(d.grossUSD)}</strong> <span class="ilp-sub">/ ${fs(d.grossUSD)}</span></div>
    </div>
    <div class="ilp-bd">
      <div class="ilp-sec">Tax Breakdown</div>
      ${taxRows}
      <div class="ilp-div"></div>
      <div class="ilp-total">
        <span class="ilp-total-lbl">Total tax (est.)</span>
        <span class="ilp-total-amt">−${fp(d.taxUSD)} <span class="ilp-tr-ils">/ −${fs(d.taxUSD)}</span></span>
      </div>
    </div>
    <div class="ilp-net">
      <div class="ilp-net-lbl">Net proceeds</div>
      <div class="ilp-net-val">${fp(netUSD)}</div>
      <div class="ilp-net-ils">${fs(netUSD)}</div>
    </div>
    <div class="ilp-bar-sec">
      <div class="ilp-bar">
        <div class="ilp-bar-tax" style="width:${taxPct}%">${parseFloat(taxPct) > 10 ? taxPct + '%' : ''}</div>
        <div class="ilp-bar-net" style="width:${netPct}%">${parseFloat(netPct) > 10 ? netPct + '%' : ''}</div>
      </div>
      <div class="ilp-bar-lbls">
        <span class="ilp-lbl-tax">◼ Tax ${taxPct}%</span>
        <span class="ilp-lbl-net">Net ${netPct}% ◼</span>
      </div>
    </div>`;

  _popupEl.querySelector('#ilp-close').onclick = e => { e.stopPropagation(); _popupEl.style.display = 'none'; };
  _popupEl.querySelector('#ilp-copy').onclick = e => {
    e.stopPropagation();
    navigator.clipboard.writeText(_popupCopyText(d)).then(() => {
      const btn = _popupEl.querySelector('#ilp-copy');
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = '📋 Copy'; }, 1500);
    });
  };

  // Show off-screen to measure height, then position correctly
  _popupEl.style.visibility = 'hidden';
  _popupEl.style.display = 'block';
  requestAnimationFrame(() => {
    const ph = _popupEl.offsetHeight, pw = _popupEl.offsetWidth;
    let top  = triggerRect.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = triggerRect.top - ph - 8;
    if (top < 8) top = 8;
    let left = triggerRect.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    _popupEl.style.top  = top + 'px';
    _popupEl.style.left = left + 'px';
    _popupEl.style.visibility = 'visible';
  });
}

function _popupCopyText(d) {
  const isILS = d.currency === 'ILS';
  const fu  = n => '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  const fil = n => '₪' + Math.abs(Math.round(n * d.usdToILS)).toLocaleString('en-US');
  const fp  = n => isILS ? fil(n) : fu(n);
  const fs  = n => isILS ? fu(n) : fil(n);
  const dual = n => `${fp(n)} / ${fs(n)}`;
  const is2yr = d.yearsSinceVesting >= 2;
  const netUSD = d.grossUSD - d.taxUSD;
  const ordinaryBase = Math.min(d.grossUSD, d.benefitUSD);
  const cgBase = Math.max(0, d.grossUSD - d.benefitUSD);
  const taxPct = (d.taxUSD / d.grossUSD * 100).toFixed(1);
  const ordPct = (d.ordinaryRate * 100).toFixed(0);
  const cgPct  = (d.cgRate * 100).toFixed(0);
  const lines = [
    `IL Tax Breakdown — Vested ${d.dateText}${d.grantDateText ? ' · Grant: ' + d.grantDateText : ''} (${d.yearsSinceVesting.toFixed(1)} yrs from ${d.grantDateText ? 'grant' : 'vest'}, ${is2yr ? '≥2yr ✓' : '<2yr ✗'})`,
    `FMV at vest: $${d.fmvAtVesting.toFixed(2)}/sh  |  Sell: $${(d.grossUSD/d.qty).toFixed(2)}/sh  |  Qty: ${d.qty}`,
    `Gross proceeds: ${dual(d.grossUSD)}`,
    ``,
  ];
  if (is2yr) {
    const capitalLossUSD = d.capitalLossUSD || 0;
    lines.push(`Ordinary income (FMV × qty): ${dual(ordinaryBase)}`);
    lines.push(`  Tax @ ${ordPct}%: −${dual(d.ordinaryTaxUSD)}`);
    lines.push(`Capital gain (above FMV): ${dual(cgBase)}`);
    lines.push(`  Tax @ ${cgPct}%: −${dual(d.cgTaxUSD)}`);
    if (capitalLossUSD > 0) {
      lines.push(`Capital loss (FMV − sell): −${dual(capitalLossUSD)} (reportable; offsets future gains)`);
    }
  } else {
    lines.push(`Ordinary income (entire gross): ${dual(d.grossUSD)}`);
    lines.push(`  Tax @ ${ordPct}%: −${dual(d.taxUSD)}`);
  }
  lines.push(`Total tax: −${dual(d.taxUSD)}  (${taxPct}%)`);
  lines.push(`Net proceeds: ${dual(netUSD)}`);
  return lines.join('\n');
}

// ─── Parse failure banner ─────────────────────────────────────────────────────

function injectParseFailureBanner(table) {
  // Guard: one banner per table per session. dataset flag survives React re-renders
  // because React re-renders tbody rows, not the table element itself.
  if (table.dataset.ilBannerShown) return;
  table.dataset.ilBannerShown = 'true';

  const banner = document.createElement('div');
  banner.id = 'il-tax-parse-banner';
  banner.style.cssText = [
    'display:flex', 'align-items:flex-start', 'gap:10px',
    'background:#fff8e1', 'border:1.5px solid #ffe082',
    'border-radius:8px', 'padding:10px 14px', 'margin-bottom:8px',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-size:13px', 'color:#5d4037', 'line-height:1.5',
    'position:relative',
  ].join(';');

  banner.innerHTML = `
    <span style="font-size:16px;flex-shrink:0">⚠</span>
    <span>
      <strong>IL Tax Calculator</strong> — lot data isn't loaded yet.
      Try refreshing the page. If it persists,
      <a href="https://github.com/nisanb/etrade-rsu-israeli-tax-calculator/issues"
         target="_blank" rel="noopener"
         style="color:#1b5e20;font-weight:600;">report an issue</a>.
    </span>
    <button id="il-tax-banner-dismiss"
      style="margin-left:auto;flex-shrink:0;background:none;border:none;cursor:pointer;
             font-size:16px;color:#9e9e9e;line-height:1;padding:0 2px;"
      title="Dismiss">×</button>`;

  table.insertAdjacentElement('beforebegin', banner);

  banner.querySelector('#il-tax-banner-dismiss').addEventListener('click', () => {
    banner.remove();
  });
}

// ─── Column injection ─────────────────────────────────────────────────────────

function injectColumns(table) {
  if (!table || table.dataset.ilTaxInjected) return null;
  table.dataset.ilTaxInjected = 'true';
  _ensurePopup();

  const headerRow = table.querySelector('thead tr');
  if (headerRow) {
    ['Status', 'IL Tax', 'Net Proceeds', 'Rate', 'Tax vs Net'].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      th.className = IL_CLASS;
      th.style.cssText = STYLE_HEADER;
      headerRow.appendChild(th);
    });
  }

  const handles = [];
  table.querySelectorAll('tbody tr').forEach(row => {
    const qtyInput = row.querySelector(QTY_INPUT_SELECTOR);
    if (!qtyInput) return;
    const statusCell = _td('min-width:72px;');
    const taxCell = _td(), netCell = _td(), rateCell = _td(), splitCell = _td('min-width:110px;');
    statusCell.textContent = taxCell.textContent = netCell.textContent = rateCell.textContent = '—';
    row.append(statusCell, taxCell, netCell, rateCell, splitCell);
    // dateText/fmvText are NOT captured here — read dynamically in recalculate()
    // so stale injection data doesn't corrupt rows after React re-renders.
    handles.push({ row, qtyInput, statusCell, taxCell, netCell, rateCell, splitCell });
  });

  // existingCols excludes our 5 injected columns (Status + IL Tax + Net + Rate + Tax vs Net)
  const existingCols = headerRow ? headerRow.querySelectorAll('th').length - 5 : 5;
  const totalsRow = document.createElement('tr');
  totalsRow.className = IL_CLASS + '-totals';
  totalsRow.style.cssText = STYLE_TOTALS_ROW;
  const spacer = document.createElement('td');
  spacer.colSpan = existingCols;
  spacer.style.cssText = 'text-align:right;padding:5px 8px;color:#555;font-size:11px;';
  spacer.textContent = 'TOTAL after IL Tax';
  const totalStatusCell = _td('background:#c8e6c9;');
  const totalTaxCell = _td('background:#c8e6c9;color:#c0392b;');
  const totalNetCell = _td('background:#c8e6c9;color:#1b5e20;');
  const totalRateCell = _td('background:#c8e6c9;');
  const totalSplitCell = _td('background:#c8e6c9;min-width:110px;');
  totalsRow.append(spacer, totalStatusCell, totalTaxCell, totalNetCell, totalRateCell, totalSplitCell);
  const tbody = table.querySelector('tbody');
  if (tbody) tbody.appendChild(totalsRow);

  return { handles, totalTaxCell, totalNetCell, totalSplitCell };
}

function _td(extraStyle = '') {
  const td = document.createElement('td');
  td.className = IL_CLASS;
  td.style.cssText = STYLE_CELL + extraStyle;
  return td;
}

const SECTION102_TOOLTIP = 'Israeli Section 102 income track. Lots held ≥2 years from grant date qualify for 25% capital gains on appreciation; <2 years are taxed at full ordinary rates.';

function updateStatusCell(statusCell, { grantDate, yearsSinceGrant }) {
  if (!grantDate) {
    statusCell.textContent = '—';
    statusCell.title = '';
    statusCell.style.background = STYLE_CELL.includes('background') ? '' : '';
    return;
  }
  const is2yr = yearsSinceGrant >= 2;
  statusCell.title = SECTION102_TOOLTIP;
  if (is2yr) {
    statusCell.innerHTML = '<span style="display:inline-block;background:#e8f5e9;color:#2e7d32;border-radius:20px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap;">✓ ≥2yr</span>';
  } else {
    statusCell.innerHTML = '<span style="display:inline-block;background:#fff3e0;color:#e65100;border-radius:20px;padding:1px 7px;font-size:10px;font-weight:700;white-space:nowrap;">⚠ <2yr</span>';
  }
}

function updateRowCells({ taxCell, netCell, rateCell, splitCell }, { taxUSD, netUSD, effectiveRate, mode, currency, usdToILS, capitalLossUSD }) {
  if (mode !== 'zero') {
    const lossIndicator = (mode === 'capital-gains' && capitalLossUSD > 0)
      ? `<span style="display:block;font-size:10px;color:#7b8fa6;margin-top:1px;">↓ ${_fmt(capitalLossUSD, currency, usdToILS)} loss</span>`
      : '';
    taxCell.innerHTML = `<span class="il-tax-amt">${_fmt(taxUSD, currency, usdToILS)}</span><span class="il-tax-info" title="Click for tax breakdown">ⓘ</span>${lossIndicator}`;
  } else {
    taxCell.textContent = '—';
  }
  netCell.textContent  = _fmt(netUSD, currency, usdToILS);
  taxCell.style.color  = '#c0392b';
  taxCell.style.cursor = mode !== 'zero' ? 'pointer' : 'default';
  netCell.style.color  = '#1b5e20';

  const pct = (effectiveRate * 100).toFixed(1);
  if (mode === 'capital-gains') {
    rateCell.textContent = `${pct}% ✓≥2yr`;
    rateCell.style.background = '#f1f8e9';
  } else if (mode === 'flat-ordinary') {
    rateCell.textContent = `${pct}% <2yr`;
    rateCell.style.background = '#fff8e1';
  } else if (mode === 'bracket') {
    rateCell.textContent = `~${pct}% <2yr`;
    rateCell.style.background = '#fff3e0';
  } else {
    rateCell.textContent = '—';
  }

  if (splitCell) _renderSplitBar(splitCell, taxUSD, netUSD);
}

function _renderSplitBar(cell, taxUSD, netUSD) {
  const gross = taxUSD + netUSD;
  if (gross <= 0) { cell.innerHTML = ''; return; }
  const tp = (taxUSD / gross * 100).toFixed(1);
  const np = (100 - parseFloat(tp)).toFixed(1);
  cell.innerHTML =
    `<div style="display:flex;height:10px;border-radius:5px;overflow:hidden;margin-bottom:3px">` +
      `<div style="width:${tp}%;background:#ef5350"></div>` +
      `<div style="width:${np}%;background:#43a047"></div>` +
    `</div>` +
    `<div style="display:flex;justify-content:space-between;font-size:10px;line-height:1">` +
      `<span style="color:#ef5350">${tp}%</span>` +
      `<span style="color:#43a047">${np}%</span>` +
    `</div>`;
}

function updateTotals(totalTaxCell, totalNetCell, totalSplitCell, totalTaxUSD, totalNetUSD, currency, usdToILS) {
  totalTaxCell.textContent = _fmt(totalTaxUSD, currency, usdToILS);
  totalNetCell.textContent = _fmt(totalNetUSD, currency, usdToILS);
  _renderSplitBar(totalSplitCell, totalTaxUSD, totalNetUSD);
}

function _fmt(usd, currency, usdToILS) {
  if (currency === 'ILS') {
    return '₪' + Math.round(usd * usdToILS).toLocaleString('he-IL');
  }
  return '$' + Math.round(usd).toLocaleString('en-US');
}
