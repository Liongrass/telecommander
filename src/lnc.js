import LNC from '@lightninglabs/lnc-web';

const NAMESPACE = 'telecommander';
const DEFAULT_PROXY = 'mailbox.terminal.lightning.today:443';

let lnc = null;

const log = (...args) => console.log('[LNC]', ...args);

function ensureLNC() {
  if (!lnc) {
    log('Creating LNC instance, namespace:', NAMESPACE);
    lnc = new LNC({ namespace: NAMESPACE });
    log('LNC instance keys:', Object.keys(lnc));

    // Log any observable status properties every 2s for 30s after creation
    let ticks = 0;
    const poller = setInterval(() => {
      log(`[tick ${++ticks}] isConnected:`, lnc.isConnected, '| isReady:', lnc.isReady, '| status:', lnc.status);
      if (ticks >= 15) clearInterval(poller);
    }, 2000);
  }
  return lnc;
}

/** True if credentials are already stored in localStorage from a prior session. */
export function isPaired() {
  try {
    const temp = new LNC({ namespace: NAMESPACE });
    const paired = temp.credentials?.isPaired ?? false;
    log('isPaired check:', paired);
    return paired;
  } catch (e) {
    log('isPaired error:', e);
    return false;
  }
}

/** First-time pair: store the pairing phrase and connect. */
export async function pair(pairingPhrase, password) {
  log('Pairing — phrase word count:', pairingPhrase.trim().split(/\s+/).length);
  // Pass pairingPhrase via constructor so lnc-web initialises the WASM with it
  lnc = new LNC({
    namespace: NAMESPACE,
    pairingPhrase: pairingPhrase.trim(),
    password,
  });
  const l = lnc;
  log('Credentials before connect:', {
    isPaired: l.credentials?.isPaired,
    serverHost: l.credentials?.serverHost,
    localKey: l.credentials?.localKey ? '(set)' : '(unset)',
    remoteKey: l.credentials?.remoteKey ? '(set)' : '(unset)',
  });
  log('Calling l.connect()…');
  await l.connect();
  log('connect() resolved — isConnected:', l.isConnected, '| isReady:', l.isReady, '| status:', l.status);
  assertConnected(l);
  // Clear the stored pairing phrase so reconnects use localKey/remoteKey only
  l.credentials.pairingPhrase = '';
  log('Pairing phrase cleared from credential store');
  return l.isConnected;
}

/** Subsequent login: unlock stored credentials with the password. */
export async function login(password) {
  const l = ensureLNC();
  log('Logging in with stored credentials');
  l.credentials.password = password;
  l.credentials.pairingPhrase = '';
  log('Credentials before connect:', {
    isPaired: l.credentials?.isPaired,
    serverHost: l.credentials?.serverHost,
    localKey: l.credentials?.localKey ? '(set)' : '(unset)',
    remoteKey: l.credentials?.remoteKey ? '(set)' : '(unset)',
  });
  log('Calling l.connect()…');
  await l.connect();
  log('connect() resolved — isConnected:', l.isConnected, '| isReady:', l.isReady, '| status:', l.status);
  assertConnected(l);
  return l.isConnected;
}

function assertConnected(l) {
  if (!l.isConnected) {
    const status = l.status || 'Unknown error';
    lnc = null; // reset so next attempt gets a fresh instance
    throw new Error(status);
  }
}

export function disconnect() {
  lnc?.disconnect();
  // Clear stored credentials
  try {
    const l = ensureLNC();
    l.credentials?.clear?.();
  } catch {}
  lnc = null;
}

export function isConnected() {
  return lnc?.isConnected ?? false;
}

// ── Invoice operations ──────────────────────────────────────

/**
 * Create a Lightning invoice.
 * @param {number} valueSats - Amount in satoshis
 * @param {string} memo      - Invoice memo / description
 * @param {number} expiry    - Expiry in seconds
 * @returns {Promise<{paymentRequest: string, rHash: string, addIndex: string}>}
 */
export async function createInvoice(valueSats, memo, expiry) {
  const l = ensureLNC();
  const resp = await l.lnd.lightning.addInvoice({
    value: String(valueSats),
    memo,
    expiry: String(expiry),
  });
  log('addInvoice rHash type:', typeof resp.rHash, '| value:', resp.rHash);
  return {
    paymentRequest: resp.paymentRequest,
    rHash: resp.rHash,  // pass through raw — lookupInvoice will use it directly
    addIndex: resp.addIndex,
  };
}

/**
 * Look up an invoice by its payment hash.
 * Accepts whatever type lnc-web returns for rHash (bytes, base64 string, Uint8Array).
 */
export async function lookupInvoice(rHash) {
  const l = ensureLNC();
  // Try rHash (bytes) first; fall back to rHashStr (hex) if it looks like a hex string
  if (typeof rHash === 'string' && /^[0-9a-f]{64}$/i.test(rHash)) {
    return l.lnd.lightning.lookupInvoice({ rHashStr: rHash });
  }
  return l.lnd.lightning.lookupInvoice({ rHash });
}

/**
 * List recent invoices, newest first.
 * @param {number} limit
 */
export async function listRecentInvoices(limit = 3) {
  const l = ensureLNC();
  const resp = await l.lnd.lightning.listInvoices({
    reversed: true,
    numMaxInvoices: String(limit),
  });
  return resp.invoices ?? [];
}

// ── Polling helper ──────────────────────────────────────────

/**
 * Poll a specific invoice until it is settled, expired, or cancelled.
 *
 * @param {string}   rHashHex     - Payment hash (hex)
 * @param {number}   timeoutMs    - Total timeout in ms
 * @param {Function} onPaid       - Called with the invoice when settled
 * @param {Function} onExpired    - Called when timeout elapses without payment
 * @param {Function} [onError]    - Called on unrecoverable polling error
 * @returns {{ cancel: Function }} - Call cancel() to stop polling
 */
export function pollInvoice(rHashHex, timeoutMs, onPaid, onExpired, onError) {
  const cancelToken = { cancelled: false };
  const deadline = Date.now() + timeoutMs;
  let timer = null;

  async function tick() {
    if (cancelToken.cancelled) return;

    if (Date.now() >= deadline) {
      onExpired();
      return;
    }

    try {
      const invoice = await lookupInvoice(rHashHex);
      if (cancelToken.cancelled) return;

      if (invoice.settled) {
        onPaid(invoice);
        return;
      }
    } catch (err) {
      if (!cancelToken.cancelled && onError) {
        onError(err);
      }
    }

    if (!cancelToken.cancelled) {
      timer = setTimeout(tick, 2000);
    }
  }

  timer = setTimeout(tick, 2000);

  return {
    cancel() {
      cancelToken.cancelled = true;
      if (timer) clearTimeout(timer);
    },
  };
}

