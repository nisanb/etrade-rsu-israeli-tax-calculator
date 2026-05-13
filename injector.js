// injector.js
const SELLABLE_TABLE_SELECTOR = 'table.et-table--sellable'; // fallback; content.js uses _findSellableTable() first
const QTY_INPUT_SELECTOR = 'input[type="number"], input[type="text"]';

const IL_CLASS = 'il-tax-col';
const STYLE_HEADER = 'background:#e8f5e9;color:#1b5e20;padding:5px 8px;font-size:11px;white-space:nowrap;border-top:2px solid #4caf50;';
const STYLE_CELL   = 'background:#f1f8e9;padding:5px 8px;font-size:11px;';
const STYLE_TOTALS_ROW = 'background:#e8f5e9;font-weight:bold;';

// Injects IL Tax, Net Proceeds, Rate Applied columns into `table`.
// Returns { handles: [{ row, qtyInput, taxCell, netCell, rateCell }], totalTaxCell, totalNetCell }
// or null if already injected or table is falsy.
function injectColumns(table) {
  if (!table || table.dataset.ilTaxInjected) return null;
  table.dataset.ilTaxInjected = 'true';

  const headerRow = table.querySelector('thead tr');
  if (headerRow) {
    ['IL Tax', 'Net Proceeds', 'Rate'].forEach(label => {
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
    const taxCell = _td(), netCell = _td(), rateCell = _td();
    taxCell.textContent = netCell.textContent = rateCell.textContent = '—';
    row.append(taxCell, netCell, rateCell);
    handles.push({ row, qtyInput, taxCell, netCell, rateCell });
  });

  const existingCols = headerRow ? headerRow.querySelectorAll('th').length - 3 : 5;
  const totalsRow = document.createElement('tr');
  totalsRow.className = IL_CLASS + '-totals';
  totalsRow.style.cssText = STYLE_TOTALS_ROW;
  const spacer = document.createElement('td');
  spacer.colSpan = existingCols;
  spacer.style.cssText = 'text-align:right;padding:5px 8px;color:#555;font-size:11px;';
  spacer.textContent = 'TOTAL after IL Tax';
  const totalTaxCell = _td('background:#c8e6c9;color:#c0392b;');
  const totalNetCell = _td('background:#c8e6c9;color:#1b5e20;');
  const totalRateCell = _td('background:#c8e6c9;');
  totalsRow.append(spacer, totalTaxCell, totalNetCell, totalRateCell);
  const tbody = table.querySelector('tbody');
  if (tbody) tbody.appendChild(totalsRow);

  return { handles, totalTaxCell, totalNetCell };
}

function _td(extraStyle = '') {
  const td = document.createElement('td');
  td.className = IL_CLASS;
  td.style.cssText = STYLE_CELL + extraStyle;
  return td;
}

// Updates a single row's three injected cells.
function updateRowCells({ taxCell, netCell, rateCell }, { taxUSD, netUSD, effectiveRate, mode, currency, usdToILS }) {
  taxCell.textContent  = _fmt(taxUSD, currency, usdToILS);
  netCell.textContent  = _fmt(netUSD, currency, usdToILS);
  taxCell.style.color  = '#c0392b';
  netCell.style.color  = '#1b5e20';

  const pct = (effectiveRate * 100).toFixed(1);
  if (mode === 'capital-gains') {
    rateCell.textContent = `${pct}% CG ✓2yr`;
    rateCell.style.background = '#f1f8e9';
  } else if (mode === 'flat-ordinary') {
    rateCell.textContent = `${pct}% inc <2yr`;
    rateCell.style.background = '#fff8e1';
  } else if (mode === 'bracket') {
    rateCell.textContent = `~${pct}% eff <2yr`;
    rateCell.style.background = '#fff3e0';
  } else {
    rateCell.textContent = '—';
  }
}

function updateTotals(totalTaxCell, totalNetCell, totalTaxUSD, totalNetUSD, currency, usdToILS) {
  totalTaxCell.textContent = _fmt(totalTaxUSD, currency, usdToILS);
  totalNetCell.textContent = _fmt(totalNetUSD, currency, usdToILS);
}

function _fmt(usd, currency, usdToILS) {
  if (currency === 'ILS') {
    return '₪' + Math.round(usd * usdToILS).toLocaleString('he-IL');
  }
  return '$' + Math.round(usd).toLocaleString('en-US');
}
