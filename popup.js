// popup.js
// chrome.storage.sync stores rates as percentages (47, 25).
// Messages to content script send rates as decimals (divide by 100 before sending).

const DEFAULTS = {
  incomeMode: 'flat',
  flatOrdinaryRate: 47, capitalGainsRate: 25,
  capitalGainsSurtax: false, residentCreditILS: 7986,
  ytdTaxableIncomeILS: 0,
  monthlySalaryILS: 0, useMonthlySalary: false,
  usdToILS: 3.65, currency: 'USD',
};

function _sendToContent(patch) {
  chrome.storage.sync.get(DEFAULTS, (current) => {
    const merged = { ...current, ...patch };
    chrome.storage.sync.set(merged, () => {
      const msg = {
        type: 'SETTINGS_UPDATED',
        settings: {
          ...merged,
          flatOrdinaryRate: merged.flatOrdinaryRate / 100,
          capitalGainsRate: merged.capitalGainsRate / 100,
        },
      };
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, msg);
      });
    });
  });
}

function _setMode(mode) {
  document.getElementById('modeFlat').classList.toggle('active', mode === 'flat');
  document.getElementById('modeBracket').classList.toggle('active', mode === 'bracket');
  document.getElementById('flatSection').classList.toggle('hidden', mode !== 'flat');
  document.getElementById('bracketSection').classList.toggle('hidden', mode !== 'bracket');
  document.getElementById('hintFlat').classList.toggle('hidden', mode !== 'flat');
  document.getElementById('hintBracket').classList.toggle('hidden', mode !== 'bracket');
  _updateRateRowVisibility();
}

function _setCurrency(currency) {
  document.getElementById('currUSD').classList.toggle('active', currency === 'USD');
  document.getElementById('currILS').classList.toggle('active', currency === 'ILS');
  _updateRateRowVisibility();
}

function _applyMonthlySalaryUI(useMonthly, monthlyValue) {
  const monthlyRow = document.getElementById('monthlySalaryRow');
  const ytdInput   = document.getElementById('ytdTaxableIncomeILS');
  const hint       = document.getElementById('autoYtdHint');
  monthlyRow.classList.toggle('hidden', !useMonthly);
  ytdInput.disabled = useMonthly;
  ytdInput.style.opacity = useMonthly ? '0.55' : '1';
  if (useMonthly) {
    const months = new Date().getMonth() + 1;
    const monthly = Math.max(0, parseFloat(monthlyValue) || 0);
    const auto = Math.round(monthly * months);
    ytdInput.value = auto;
    hint.textContent = `Auto-YTD: ₪${auto.toLocaleString('en-US')} (${months} months × ₪${monthly.toLocaleString('en-US')})`;
  } else {
    hint.textContent = '';
  }
}

function _updateRateRowVisibility() {
  const isFlat = document.getElementById('modeFlat').classList.contains('active');
  const isUSD = document.getElementById('currUSD').classList.contains('active');
  document.getElementById('rateRow').classList.toggle('hidden', isFlat && isUSD);
}

function _rateLabel(rateData) {
  if (!rateData) return 'Rate unavailable';
  const d = new Date(rateData.fetchedAt).toLocaleDateString('en-US');
  return `${rateData.source} · ${d}${rateData.manualOverride ? ' ⚠ override' : ''}`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('appVersion').textContent = 'v' + chrome.runtime.getManifest().version;

  chrome.storage.sync.get(DEFAULTS, (s) => {
    document.getElementById('flatOrdinaryRate').value   = s.flatOrdinaryRate;
    document.getElementById('capitalGainsRate').value   = s.capitalGainsRate;
    document.getElementById('capitalGainsSurtax').checked = s.capitalGainsSurtax;
    document.getElementById('residentCreditILS').value      = s.residentCreditILS;
    document.getElementById('ytdTaxableIncomeILS').value    = s.ytdTaxableIncomeILS;
    document.getElementById('monthlySalaryILS').value       = s.monthlySalaryILS;
    document.getElementById('useMonthlySalary').checked     = s.useMonthlySalary;
    document.getElementById('usdToILS').value               = s.usdToILS;
    _setMode(s.incomeMode);
    _setCurrency(s.currency);
    _applyMonthlySalaryUI(s.useMonthlySalary, s.monthlySalaryILS);
  });

  chrome.storage.local.get('exchangeRateCache', (stored) => {
    const c = stored.exchangeRateCache;
    if (c) {
      document.getElementById('usdToILS').value = c.rate;
      document.getElementById('rateSource').textContent = _rateLabel(c);
    } else {
      document.getElementById('rateSource').textContent = 'Fetching…';
      getExchangeRate().then(r => {
        if (r) {
          document.getElementById('usdToILS').value = r.rate;
          document.getElementById('rateSource').textContent = _rateLabel(r);
          _sendToContent({ usdToILS: r.rate });
        }
      });
    }
  });

  document.getElementById('modeFlat').addEventListener('click', () => {
    _setMode('flat'); _sendToContent({ incomeMode: 'flat' });
  });
  document.getElementById('modeBracket').addEventListener('click', () => {
    _setMode('bracket'); _sendToContent({ incomeMode: 'bracket' });
  });
  document.getElementById('currUSD').addEventListener('click', () => {
    _setCurrency('USD'); _sendToContent({ currency: 'USD' });
  });
  document.getElementById('currILS').addEventListener('click', () => {
    _setCurrency('ILS'); _sendToContent({ currency: 'ILS' });
  });
  document.getElementById('flatOrdinaryRate').addEventListener('input', e => {
    _sendToContent({ flatOrdinaryRate: parseFloat(e.target.value) || 0 });
  });
  document.getElementById('capitalGainsRate').addEventListener('input', e => {
    _sendToContent({ capitalGainsRate: parseFloat(e.target.value) || 0 });
  });
  document.getElementById('capitalGainsSurtax').addEventListener('change', e => {
    _sendToContent({ capitalGainsSurtax: e.target.checked });
  });
  document.getElementById('residentCreditILS').addEventListener('input', e => {
    _sendToContent({ residentCreditILS: parseFloat(e.target.value) || 0 });
  });
  document.getElementById('ytdTaxableIncomeILS').addEventListener('input', e => {
    _sendToContent({ ytdTaxableIncomeILS: parseFloat(e.target.value) || 0 });
  });
  document.getElementById('useMonthlySalary').addEventListener('change', e => {
    const checked = e.target.checked;
    const monthly = parseFloat(document.getElementById('monthlySalaryILS').value) || 0;
    _applyMonthlySalaryUI(checked, monthly);
    const patch = { useMonthlySalary: checked };
    if (checked) patch.ytdTaxableIncomeILS = Math.round(monthly * (new Date().getMonth() + 1));
    _sendToContent(patch);
  });
  document.getElementById('monthlySalaryILS').addEventListener('input', e => {
    const monthly = parseFloat(e.target.value) || 0;
    const useMonthly = document.getElementById('useMonthlySalary').checked;
    _applyMonthlySalaryUI(useMonthly, monthly);
    const patch = { monthlySalaryILS: monthly };
    if (useMonthly) patch.ytdTaxableIncomeILS = Math.round(monthly * (new Date().getMonth() + 1));
    _sendToContent(patch);
  });
  document.getElementById('usdToILS').addEventListener('input', e => {
    const rate = parseFloat(e.target.value);
    if (!isNaN(rate) && rate > 0) {
      setManualExchangeRate(rate);
      document.getElementById('rateSource').textContent = _rateLabel(
        { source: 'manual', fetchedAt: Date.now(), manualOverride: true }
      );
      _sendToContent({ usdToILS: rate });
    }
  });
  document.getElementById('refreshRate').addEventListener('click', async () => {
    document.getElementById('rateSource').textContent = 'Fetching…';
    const fresh = await refreshExchangeRate();
    if (fresh) {
      document.getElementById('usdToILS').value = fresh.rate;
      document.getElementById('rateSource').textContent = _rateLabel(fresh);
      _sendToContent({ usdToILS: fresh.rate });
    } else {
      document.getElementById('rateSource').textContent = 'Fetch failed — using cached';
    }
  });
  document.getElementById('goToHoldings').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://us.etrade.com/etx/sp/stockplan#/sell' });
  });
});
