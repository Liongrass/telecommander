/** Fetch BTC price in the configured fiat currency. Returns a number (price per BTC). */
export async function fetchBtcRate(settings) {
  const { currency, currencyApi, customApiUrl } = settings;
  const cur = currency.toLowerCase();

  if (currencyApi === 'coingecko') {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${cur}`;
    const res = await fetch(url);
    if (res.status === 429) throw new Error('CoinGecko rate limit reached — try again in a minute, or switch to Blockchain.info in settings');
    if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
    const data = await res.json();
    const rate = data?.bitcoin?.[cur];
    if (!rate) throw new Error(`CoinGecko: no rate for ${currency}`);
    return rate;
  }

  if (currencyApi === 'blockchain') {
    const res = await fetch('https://blockchain.info/ticker');
    if (res.status === 429) throw new Error('Blockchain.info rate limit reached — try again shortly');
    if (!res.ok) throw new Error(`Blockchain.info returned ${res.status}`);
    const data = await res.json();
    const rate = data?.[currency.toUpperCase()]?.last;
    if (!rate) throw new Error(`Blockchain.info: no rate for ${currency}`);
    return rate;
  }

  if (currencyApi === 'custom') {
    if (!customApiUrl) throw new Error('No custom API URL configured');
    const res = await fetch(customApiUrl);
    if (!res.ok) throw new Error(`Custom API returned ${res.status}`);
    const data = await res.json();
    // Accept common key shapes: rate | price | {currency_lower}
    const rate = data?.rate ?? data?.price ?? data?.[cur] ?? data?.[currency.toUpperCase()];
    if (rate == null) throw new Error('Custom API response has no recognisable rate field');
    return Number(rate);
  }

  throw new Error(`Unknown currencyApi: ${currencyApi}`);
}

/** Convert a fiat amount to satoshis given the BTC price in that fiat. */
export function fiatToSats(fiatAmount, btcRateInFiat) {
  if (!btcRateInFiat || btcRateInFiat <= 0) throw new Error('Invalid exchange rate');
  const btc = fiatAmount / btcRateInFiat;
  return Math.round(btc * 100_000_000);
}

/** Format a satoshi amount with thousand separators. */
export function formatSats(sats) {
  return sats.toLocaleString() + ' sats';
}
