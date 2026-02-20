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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const symbols = (req.query.symbols || '').split(',').filter(Boolean);
  if (symbols.length === 0) {
    return res.status(400).json({ error: 'symbols parameter required' });
  }

  const results = {};
  for (const sym of symbols) {
    try {
      const data = await avFetch({ function: 'GLOBAL_QUOTE', symbol: sym });
      const q = data['Global Quote'];
      if (q && q['05. price']) {
        results[sym] = {
          symbol: sym,
          price: parseFloat(q['05. price']),
          previousClose: parseFloat(q['08. previous close']),
          change: parseFloat(q['09. change']),
          changePercent: parseFloat(q['10. change percent']),
          dayHigh: parseFloat(q['03. high']),
          dayLow: parseFloat(q['04. low']),
          volume: parseInt(q['06. volume']),
          name: sym,
        };
      }
      if (symbols.length > 1) await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      console.warn(`Quote failed for ${sym}:`, e.message);
    }
  }

  res.json({ quotes: results, timestamp: new Date().toISOString() });
}
