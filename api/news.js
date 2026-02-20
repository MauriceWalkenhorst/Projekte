const AV_KEY = process.env.ALPHAVANTAGE_KEY;
const AV_BASE = 'https://www.alphavantage.co/query';

function formatAvDate(str) {
  if (!str || str.length < 8) return null;
  const y = str.slice(0, 4), m = str.slice(4, 6), d = str.slice(6, 8);
  const h = str.slice(9, 11) || '00', min = str.slice(11, 13) || '00';
  return `${y}-${m}-${d}T${h}:${min}:00Z`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const tickers = (req.query.tickers || 'URTH,SPY,EEM')
    .split(',').filter(Boolean).slice(0, 5).join(',');

  try {
    const url = new URL(AV_BASE);
    url.searchParams.set('apikey', AV_KEY);
    url.searchParams.set('function', 'NEWS_SENTIMENT');
    url.searchParams.set('tickers', tickers);
    url.searchParams.set('limit', '15');
    url.searchParams.set('sort', 'LATEST');

    const response = await fetch(url.toString());
    const data = await response.json();

    if (data['Note']) {
      return res.status(429).json({ error: 'Rate limit reached', news: [] });
    }

    const news = (data.feed || []).map(item => ({
      title: item.title,
      link: item.url,
      publisher: item.source,
      publishedAt: formatAvDate(item.time_published),
      summary: item.summary,
      sentiment: item.overall_sentiment_label,
      sentimentScore: item.overall_sentiment_score,
      relatedTickers: (item.ticker_sentiment || []).map(t => t.ticker),
      thumbnail: item.banner_image || null,
    }));

    res.json({ news, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, news: [] });
  }
}
