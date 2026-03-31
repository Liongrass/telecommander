const KEY = 'tc_settings';

const DEFAULTS = {
  currency: 'USD',
  currencyApi: 'coingecko',   // 'coingecko' | 'blockchain' | 'custom'
  customApiUrl: '',
  defaultMemo: 'Payment',
  invoiceTimeout: 300,        // seconds
};

export function getSettings() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}


/** Returns the currency symbol for common currencies, falls back to the code. */
export function currencySymbol(code) {
  const map = {
    USD: '$', EUR: '€', GBP: '£', JPY: '¥', AUD: 'A$',
    CAD: 'C$', CHF: 'Fr', SEK: 'kr', NOK: 'kr', DKK: 'kr',
    SGD: 'S$', HKD: 'HK$', NZD: 'NZ$', MXN: '$', BRL: 'R$', ZAR: 'R',
  };
  return map[code] ?? code;
}
