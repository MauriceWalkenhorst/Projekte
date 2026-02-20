const AV_KEY = process.env.ALPHAVANTAGE_KEY;
const AV_BASE = 'https://www.alphavantage.co/query';

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

const DAYS_MAP = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1J': 365, '3J': 1095, 'MAX': 3650 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { symbol, period = '6M' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const isLong = ['1J', '3J', 'MAX'].includes(period);
  const fn = isLong ? 'TIME_SERIES_WEEKLY' : 'TIME_SERIES_DAILY';
  const seriesKey = isLong ? 'Weekly Time Series' : 'Time Series (Daily)';
  const maxDays = DAYS_MAP[period] || 180;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);

  try {
    const data = await avFetch({ function: fn, symbol, outputsize: 'full' });
    const series = data[seriesKey];
    if (!series) return res.json({ symbol, period, data: [] });

    const result = Object.entries(series)
      .map(([date, v]) => ({
        date,
        open: parseFloat(v['1. open']),
        high: parseFloat(v['2. high']),
        low: parseFloat(v['3. low']),
        close: parseFloat(v['4. close']),
        volume: parseInt(v['5. volume']),
      }))
      .filter(d => new Date(d.date) >= cutoff)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ symbol, period, data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
