const AV_KEY = process.env.ALPHAVANTAGE_KEY;
const AV_BASE = 'https://www.alphavantage.co/query';

const INDEX_SYMBOLS = {
  msci_world:  { symbol: 'URTH', name: 'MSCI World' },
  sp500:       { symbol: 'SPY',  name: 'S&P 500' },
  eurostoxx50: { symbol: 'FEZ',  name: 'EURO STOXX 50' },
  dax:         { symbol: 'EWG',  name: 'DAX' },
  nasdaq100:   { symbol: 'QQQ',  name: 'NASDAQ 100' },
  msci_em:     { symbol: 'EEM',  name: 'MSCI Emerging Markets' },
};

const DAYS_MAP = { '1M': 30, '3M': 90, '6M': 180, '1J': 365, '3J': 1095, 'MAX': 3650 };

async function avFetch(params) {
  const url = new URL(AV_BASE);
  url.searchParams.set('apikey', AV_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data['Error Message']) throw new Error(data['Error Message']);
  if (data['Note']) throw new Error('Rate limit reached');
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { period = '6M' } = req.query;
  const isLong = ['1J', '3J', 'MAX'].includes(period);
  const fn = isLong ? 'TIME_SERIES_WEEKLY' : 'TIME_SERIES_DAILY';
  const seriesKey = isLong ? 'Weekly Time Series' : 'Time Series (Daily)';
  const maxDays = DAYS_MAP[period] || 180;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);

  const results = {};

  for (const [key, info] of Object.entries(INDEX_SYMBOLS)) {
    try {
      const data = await avFetch({ function: fn, symbol: info.symbol, outputsize: 'full' });
      const series = data[seriesKey];
      if (!series) continue;

      const points = Object.entries(series)
        .map(([date, v]) => ({ date, close: parseFloat(v['4. close']) }))
        .filter(d => new Date(d.date) >= cutoff)
        .sort((a, b) => new Date(a.date) - new Date(b.date));

      if (points.length > 0) {
        const base = points[0].close;
        results[key] = {
          symbol: info.symbol,
          name: info.name,
          data: points.map(d => ({
            date: d.date,
            close: d.close,
            returnPct: ((d.close - base) / base) * 100,
          })),
        };
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.warn(`Index ${key} failed:`, e.message);
    }
  }

  res.json({ indices: results, period, timestamp: new Date().toISOString() });
}
