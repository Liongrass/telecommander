import LNC from '@lightninglabs/lnc-web';

const NAMESPACE = 'telecommander';

let lnc = null;

function ensureLNC() {
  if (!lnc) {
    lnc = new LNC({ namespace: NAMESPACE });
  }
  return lnc;
}

/** True if credentials are already stored in localStorage from a prior session. */
export function isPaired() {
  try {
    const l = ensureLNC();
    return l.credentials?.isPaired ?? false;
  } catch {
    return false;
  }
}

/** First-time pair: store the pairing phrase and connect. */
export async function pair(pairingPhrase, password) {
  const l = ensureLNC();
  l.pairingPhrase = pairingPhrase.trim();
  l.password = password;
  await l.connect();
  return l.isConnected;
}

/** Subsequent login: unlock stored credentials with the password. */
export async function login(password) {
  const l = ensureLNC();
  l.password = password;
  await l.connect();
  return l.isConnected;
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
  return {
    paymentRequest: resp.paymentRequest,
    rHash: rHashToHex(resp.rHash),
    addIndex: resp.addIndex,
  };
}

/**
 * Look up an invoice by its payment hash (hex string).
 * Returns the invoice object.
 */
export async function lookupInvoice(rHashHex) {
  const l = ensureLNC();
  return l.lnd.lightning.lookupInvoice({ rHashStr: rHashHex });
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

// ── Utility ─────────────────────────────────────────────────

function rHashToHex(rHash) {
  if (!rHash) return '';
  // Already a hex string (64 lowercase hex chars)
  if (typeof rHash === 'string' && /^[0-9a-f]{64}$/i.test(rHash)) return rHash.toLowerCase();
  // Base64 string → hex
  if (typeof rHash === 'string') {
    try {
      const bin = atob(rHash);
      return Array.from(bin).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    } catch {}
  }
  // Uint8Array → hex
  if (rHash instanceof Uint8Array) {
    return Array.from(rHash).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Array of numbers
  if (Array.isArray(rHash)) {
    return rHash.map(b => Number(b).toString(16).padStart(2, '0')).join('');
  }
  return String(rHash);
}
