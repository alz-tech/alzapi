const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// ── Simple in-memory cache (5 min for currency, 2 min for crypto) ─────────
const cache = new Map();
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data, ttlMs) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ── Currency: frankfurter.app (free, no key, ECB data) ───────────────────
async function getFxRates(base = 'USD') {
  const cacheKey = `fx_${base.toUpperCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const r = await fetch(`https://api.frankfurter.app/latest?base=${base.toUpperCase()}`, { timeout: 10000 });
  if (!r.ok) throw new Error(`Currency API error: ${r.status}`);
  const data = await r.json();
  setCache(cacheKey, data, 5 * 60 * 1000); // 5 min
  return data;
}

// ── Crypto: CoinGecko public API (free, no key) ───────────────────────────
async function getCryptoPrices(ids = 'bitcoin,ethereum,solana', vs = 'usd') {
  const cacheKey = `crypto_${ids}_${vs}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
  const r = await fetch(url, {
    timeout: 10000,
    headers: { 'Accept': 'application/json' },
  });
  if (!r.ok) throw new Error(`Crypto API error: ${r.status}. CoinGecko may be rate-limiting.`);
  const data = await r.json();
  setCache(cacheKey, data, 2 * 60 * 1000); // 2 min
  return data;
}

// ── GET /api/currency/convert?from=USD&to=NGN&amount=100 ──────────────────
router.get('/convert', async (req, res) => {
  let { from = 'USD', to = 'NGN', amount = 1 } = req.query;
  from = from.toUpperCase(); to = to.toUpperCase();
  amount = parseFloat(amount);
  if (isNaN(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'Invalid amount.' });

  try {
    const rates = await getFxRates(from);
    const rate = rates.rates[to];
    if (!rate) return res.status(400).json({ success: false, error: `Currency '${to}' not found. Use /api/currency/list for supported currencies.` });

    res.json({
      success: true,
      from,
      to,
      amount,
      rate,
      result: parseFloat((amount * rate).toFixed(6)),
      result_formatted: (amount * rate).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      timestamp: rates.date,
      source: 'European Central Bank via frankfurter.app',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/currency/rates?base=USD ─────────────────────────────────────
router.get('/rates', async (req, res) => {
  const { base = 'USD' } = req.query;
  try {
    const data = await getFxRates(base.toUpperCase());
    res.json({
      success: true,
      base: data.base,
      date: data.date,
      rates: data.rates,
      count: Object.keys(data.rates).length,
      source: 'European Central Bank via frankfurter.app',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/currency/list ────────────────────────────────────────────────
router.get('/list', async (req, res) => {
  const cacheKey = 'fx_currencies';
  let currencies = getCache(cacheKey);
  if (!currencies) {
    try {
      const r = await fetch('https://api.frankfurter.app/currencies', { timeout: 8000 });
      currencies = await r.json();
      setCache(cacheKey, currencies, 60 * 60 * 1000); // 1 hour
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  res.json({ success: true, currencies, count: Object.keys(currencies).length });
});

// ── GET /api/currency/history?from=USD&to=NGN&days=30 ────────────────────
router.get('/history', async (req, res) => {
  let { from = 'USD', to = 'NGN', days = 30 } = req.query;
  from = from.toUpperCase(); to = to.toUpperCase();
  days = Math.min(parseInt(days) || 30, 365);

  const end = new Date().toISOString().split('T')[0];
  const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  try {
    const r = await fetch(`https://api.frankfurter.app/${start}..${end}?base=${from}&symbols=${to}`, { timeout: 10000 });
    const data = await r.json();
    const history = Object.entries(data.rates || {}).map(([date, rates]) => ({
      date,
      rate: rates[to],
    })).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      from,
      to,
      days,
      history,
      min: Math.min(...history.map(h => h.rate)),
      max: Math.max(...history.map(h => h.rate)),
      avg: parseFloat((history.reduce((s, h) => s + h.rate, 0) / history.length).toFixed(6)),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/currency/crypto?coins=bitcoin,ethereum&vs=usd,ngn ───────────
router.get('/crypto', async (req, res) => {
  const { coins = 'bitcoin,ethereum,solana,binancecoin,dogecoin', vs = 'usd' } = req.query;

  // Sanitize inputs
  const cleanCoins = coins.toLowerCase().replace(/[^a-z0-9,\-]/g, '').split(',').slice(0, 20).join(',');
  const cleanVs = vs.toLowerCase().replace(/[^a-z,]/g, '').split(',').slice(0, 5).join(',');

  try {
    const data = await getCryptoPrices(cleanCoins, cleanVs);
    const vs_currencies = cleanVs.split(',');
    const result = Object.entries(data).map(([id, info]) => {
      const entry = { id };
      vs_currencies.forEach(v => {
        entry[v.toUpperCase()] = {
          price: info[v],
          market_cap: info[`${v}_market_cap`],
          volume_24h: info[`${v}_24h_vol`],
          change_24h: info[`${v}_24h_change`] ? parseFloat(info[`${v}_24h_change`].toFixed(2)) : null,
        };
      });
      return entry;
    });

    res.json({
      success: true,
      count: result.length,
      vs_currencies,
      data: result,
      source: 'CoinGecko',
      cached_until: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/currency/crypto/convert?from=bitcoin&to=ngn&amount=0.5 ──────
router.get('/crypto/convert', async (req, res) => {
  const { from = 'bitcoin', to = 'usd', amount = 1 } = req.query;
  const amt = parseFloat(amount);
  if (isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, error: 'Invalid amount.' });

  try {
    const data = await getCryptoPrices(from.toLowerCase(), to.toLowerCase());
    const coinData = data[from.toLowerCase()];
    if (!coinData) return res.status(400).json({ success: false, error: `Coin '${from}' not found.` });
    const price = coinData[to.toLowerCase()];
    if (price === undefined) return res.status(400).json({ success: false, error: `Currency '${to}' not supported.` });

    res.json({
      success: true,
      from: from.toLowerCase(),
      to: to.toUpperCase(),
      amount: amt,
      price_per_coin: price,
      result: parseFloat((amt * price).toFixed(2)),
      result_formatted: (amt * price).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      change_24h: coinData[`${to.toLowerCase()}_24h_change`]
        ? parseFloat(coinData[`${to.toLowerCase()}_24h_change`].toFixed(2))
        : null,
      source: 'CoinGecko',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
