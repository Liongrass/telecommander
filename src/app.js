import QRCode from 'qrcode';
import * as LNC from './lnc.js';
import { getSettings, saveSettings, hasSettings, currencySymbol } from './settings.js';
import { fetchBtcRate, fiatToSats, formatSats } from './currency.js';

// ── State ───────────────────────────────────────────────────
let settings = getSettings();
let numpadDigits = [];           // digits entered on the numpad
let btcRate = null;              // current BTC/fiat rate
let rateRefreshTimer = null;
let activePoller = null;         // invoice poll handle
let countdownTimer = null;       // setInterval for countdown bar
let invoiceStartTime = null;
let invoiceTimeoutMs = 0;

// ── Helpers ─────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
  window.scrollTo(0, 0);
}

function showToast(msg, durationMs = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), durationMs);
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearError(id) {
  const el = $(id);
  el.textContent = '';
  el.classList.add('hidden');
}

function setLoading(btnId, loading) {
  const btn = $(btnId);
  btn.disabled = loading;
  btn.dataset.origText = btn.dataset.origText || btn.textContent;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.origText;
}

// ── Numpad logic ────────────────────────────────────────────
function getAmountDisplay(digits) {
  if (digits.length === 0) return '0.00';
  const s = digits.join('');
  if (s.length <= 2) return '0.' + s.padStart(2, '0');
  return parseInt(s.slice(0, -2), 10) + '.' + s.slice(-2);
}

function getAmountValue(digits) {
  if (digits.length === 0) return 0;
  const s = digits.join('');
  if (s.length <= 2) return parseInt(s, 10) / 100;
  return parseInt(s.slice(0, -2), 10) + parseInt(s.slice(-2), 10) / 100;
}

function updateAmountDisplay() {
  $('amount-fiat-value').textContent = getAmountDisplay(numpadDigits);
  const fiat = getAmountValue(numpadDigits);
  if (btcRate && fiat > 0) {
    try {
      const sats = fiatToSats(fiat, btcRate);
      $('amount-sats').textContent = '≈ ' + formatSats(sats);
    } catch {
      $('amount-sats').textContent = '—';
    }
  } else {
    $('amount-sats').textContent = btcRate ? '—' : 'Fetching rate…';
  }
}

// ── Exchange rate ───────────────────────────────────────────
async function refreshRate() {
  try {
    btcRate = await fetchBtcRate(settings);
    updateAmountDisplay();
  } catch (err) {
    showToast('Rate fetch failed: ' + err.message, 4000);
  }
}

function startRateRefresh() {
  refreshRate();
  clearInterval(rateRefreshTimer);
  rateRefreshTimer = setInterval(refreshRate, 30_000);
}

function stopRateRefresh() {
  clearInterval(rateRefreshTimer);
}

// ── Pair / Login screen ─────────────────────────────────────
function initPairScreen() {
  const phraseGroup = $('phrase-group');
  const isPaired = LNC.isPaired();

  // If credentials exist, hide the phrase input — only need the password
  if (isPaired) {
    phraseGroup.classList.add('hidden');
  } else {
    phraseGroup.classList.remove('hidden');
  }

  $('btn-connect').onclick = async () => {
    clearError('pair-error');
    const password = $('pair-password').value;
    if (!password) { showError('pair-error', 'Password is required.'); return; }

    setLoading('btn-connect', true);
    try {
      if (isPaired) {
        await LNC.login(password);
      } else {
        const phrase = $('pairing-phrase').value.trim();
        if (!phrase) { showError('pair-error', 'Pairing phrase is required.'); return; }
        await LNC.pair(phrase, password);
      }

      // After connecting, go to settings (first time) or numpad (returning)
      if (!hasSettings()) {
        showScreen('settings');
        initSettingsScreen(false);
      } else {
        settings = getSettings();
        showScreen('numpad');
        initNumpadScreen();
      }
    } catch (err) {
      showError('pair-error', err.message || 'Connection failed. Check your credentials.');
    } finally {
      setLoading('btn-connect', false);
    }
  };
}

// ── Settings screen ─────────────────────────────────────────
function initSettingsScreen(showBack = true) {
  const s = getSettings();

  // Back button
  $('btn-settings-back').classList.toggle('hidden', !showBack);
  $('btn-settings-back').onclick = () => showScreen('numpad');

  // Populate form
  $('set-currency').value = s.currency;
  $('set-memo').value = s.defaultMemo;
  $('set-timeout').value = s.invoiceTimeout;
  $('set-custom-url').value = s.customApiUrl;

  const radios = document.querySelectorAll('input[name="rate-api"]');
  radios.forEach(r => { r.checked = (r.value === s.currencyApi); });

  updateCustomUrlVisibility(s.currencyApi);
  radios.forEach(r => r.addEventListener('change', () => updateCustomUrlVisibility(r.value)));

  clearError('settings-error');

  $('btn-settings-save').onclick = () => {
    clearError('settings-error');
    const api = document.querySelector('input[name="rate-api"]:checked')?.value;
    const timeout = parseInt($('set-timeout').value, 10);
    if (!timeout || timeout < 30 || timeout > 3600) {
      showError('settings-error', 'Timeout must be between 30 and 3600 seconds.');
      return;
    }
    if (api === 'custom' && !$('set-custom-url').value.trim()) {
      showError('settings-error', 'Please enter a Custom API URL.');
      return;
    }

    settings = saveSettings({
      currency: $('set-currency').value,
      currencyApi: api,
      customApiUrl: $('set-custom-url').value.trim(),
      defaultMemo: $('set-memo').value.trim() || 'Payment',
      invoiceTimeout: timeout,

    });

    showScreen('numpad');
    initNumpadScreen();
  };

  $('btn-disconnect').onclick = () => {
    if (!confirm('Remove LNC credentials from this browser?')) return;
    LNC.disconnect();
    showScreen('pair');
    initPairScreen();
  };
}

function updateCustomUrlVisibility(api) {
  $('custom-url-group').classList.toggle('hidden', api !== 'custom');
}

// ── Numpad screen ───────────────────────────────────────────
function initNumpadScreen() {
  settings = getSettings();
  numpadDigits = [];

  // Update currency symbol
  $('currency-symbol').textContent = currencySymbol(settings.currency);
  updateAmountDisplay();

  startRateRefresh();

  // Digit buttons
  document.querySelectorAll('.numpad-btn[data-digit]').forEach(btn => {
    btn.onclick = () => {
      // Max 8 digits (999,999.99)
      if (numpadDigits.length >= 8) return;
      // Prevent leading zeros in the dollar part
      const digit = btn.dataset.digit;
      if (numpadDigits.length === 0 && digit === '0') return;
      numpadDigits.push(digit);
      updateAmountDisplay();
    };
  });

  $('btn-backspace').onclick = () => {
    numpadDigits.pop();
    updateAmountDisplay();
  };

  $('btn-clear').onclick = () => {
    numpadDigits = [];
    updateAmountDisplay();
  };

  $('btn-open-settings').onclick = () => {
    stopRateRefresh();
    showScreen('settings');
    initSettingsScreen(true);
  };

  $('btn-open-txns').onclick = () => {
    stopRateRefresh();
    showScreen('transactions');
    loadTransactions();
  };

  $('btn-request').onclick = () => requestPayment();
  clearError('numpad-error');
}

async function requestPayment() {
  clearError('numpad-error');
  const fiatAmount = getAmountValue(numpadDigits);

  if (fiatAmount <= 0) {
    showError('numpad-error', 'Enter an amount first.');
    return;
  }

  setLoading('btn-request', true);
  try {
    // Always fetch a fresh rate at request time
    const rate = await fetchBtcRate(settings);
    btcRate = rate;
    const sats = fiatToSats(fiatAmount, rate);

    if (sats < 1) {
      showError('numpad-error', 'Amount is too small (< 1 sat).');
      return;
    }

    const invoice = await LNC.createInvoice(sats, settings.defaultMemo, settings.invoiceTimeout);

    stopRateRefresh();
    showScreen('invoice');
    showInvoice(invoice, fiatAmount, sats);
  } catch (err) {
    showError('numpad-error', err.message || 'Failed to create invoice.');
  } finally {
    setLoading('btn-request', false);
  }
}

// ── Invoice screen ──────────────────────────────────────────
function showInvoice(invoice, fiatAmount, sats) {
  const { paymentRequest, rHash } = invoice;
  const sym = currencySymbol(settings.currency);
  const timeoutMs = settings.invoiceTimeout * 1000;

  // Fill in amounts
  $('invoice-fiat-display').textContent = sym + fiatAmount.toFixed(2);
  $('invoice-sats-display').textContent = formatSats(sats);
  $('invoice-memo-display').textContent = settings.defaultMemo;

  // Render QR code
  const canvas = $('qr-canvas');
  QRCode.toCanvas(canvas, paymentRequest.toUpperCase(), {
    width: 240,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });

  // Clicking QR copies invoice to clipboard
  $('qr-container').onclick = () => {
    navigator.clipboard?.writeText(paymentRequest).then(() => showToast('Invoice copied!'));
  };

  // Reset status UI
  $('status-pending').classList.remove('hidden');
  $('status-paid').classList.add('hidden');
  $('status-expired').classList.add('hidden');
  $('countdown-wrap').classList.remove('hidden');

  // Countdown bar
  invoiceStartTime = Date.now();
  invoiceTimeoutMs = timeoutMs;
  updateCountdown();
  clearInterval(countdownTimer);
  countdownTimer = setInterval(updateCountdown, 1000);

  // Cancel button
  $('btn-cancel-invoice').onclick = () => {
    cancelInvoice();
    returnToNumpad();
  };

  // Start polling
  activePoller = LNC.pollInvoice(
    rHash,
    timeoutMs,
    () => onInvoicePaid(),
    () => onInvoiceExpired(),
    (err) => showToast('Poll error: ' + err.message, 4000),
  );
}

function updateCountdown() {
  const elapsed = Date.now() - invoiceStartTime;
  const remaining = Math.max(0, invoiceTimeoutMs - elapsed);
  const pct = (remaining / invoiceTimeoutMs) * 100;

  const bar = $('countdown-bar');
  bar.style.width = pct + '%';
  bar.style.background = pct > 30 ? 'var(--primary)' : 'var(--error)';

  const secs = Math.ceil(remaining / 1000);
  $('countdown-label').textContent = secs + 's remaining';

  if (remaining <= 0) clearInterval(countdownTimer);
}

function cancelInvoice() {
  activePoller?.cancel();
  activePoller = null;
  clearInterval(countdownTimer);
}

function onInvoicePaid() {
  clearInterval(countdownTimer);
  activePoller = null;
  $('countdown-wrap').classList.add('hidden');
  $('status-pending').classList.add('hidden');
  $('status-paid').classList.remove('hidden');

  setTimeout(returnToNumpad, 3000);
}

function onInvoiceExpired() {
  clearInterval(countdownTimer);
  activePoller = null;
  $('countdown-wrap').classList.add('hidden');
  $('status-pending').classList.add('hidden');
  $('status-expired').classList.remove('hidden');

  // Let the user dismiss manually via Cancel button (now acts as "Back")
  $('btn-cancel-invoice').textContent = '← Back';
  $('btn-cancel-invoice').onclick = returnToNumpad;
}

function returnToNumpad() {
  cancelInvoice();
  numpadDigits = [];
  showScreen('numpad');
  initNumpadScreen();
}

// ── Transactions screen ─────────────────────────────────────
async function loadTransactions() {
  const list = $('txns-list');
  list.innerHTML = '<p class="muted">Loading…</p>';

  $('btn-txns-back').onclick = () => {
    showScreen('numpad');
    initNumpadScreen();
  };

  try {
    const invoices = await LNC.listRecentInvoices(3);

    if (!invoices.length) {
      list.innerHTML = '<p class="muted">No invoices found.</p>';
      return;
    }

    list.innerHTML = '';
    invoices.forEach(inv => {
      const card = document.createElement('div');
      const isSettled = inv.settled;
      const isExpired = !isSettled && inv.expiry && Date.now() / 1000 > Number(inv.creationDate) + Number(inv.expiry);
      const statusClass = isSettled ? 'settled' : (isExpired ? 'expired' : 'pending');
      const statusLabel = isSettled ? 'Paid' : (isExpired ? 'Expired' : 'Pending');

      card.className = `txn-card ${statusClass}`;

      const sats = Number(inv.value || inv.valueMsat / 1000 || 0);
      const date = new Date(Number(inv.creationDate) * 1000).toLocaleString();
      const memo = inv.memo || '—';

      card.innerHTML = `
        <div class="txn-amount">${sats.toLocaleString()} sats</div>
        <span class="txn-status ${statusClass}">${statusLabel}</span>
        <div class="txn-meta">${memo} · ${date}</div>
      `;
      list.appendChild(card);
    });
  } catch (err) {
    list.innerHTML = `<p class="error">${err.message || 'Failed to load transactions.'}</p>`;
  }
}

// ── Boot ────────────────────────────────────────────────────
function boot() {
  if (LNC.isPaired()) {
    // Returning user — show login (password only)
    showScreen('pair');
    initPairScreen();
  } else {
    // New user — show full pair form
    showScreen('pair');
    initPairScreen();
  }
}

boot();
