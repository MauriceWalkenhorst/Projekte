const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Alpha Vantage API Key
const AV_KEY = functions.config().alphavantage?.key || "7MJJW612K9HUS2XG";
const AV_BASE = "https://www.alphavantage.co/query";

// Index symbols for Alpha Vantage (ETF-based for better coverage)
const INDEX_SYMBOLS = {
  msci_world: { symbol: "URTH", name: "MSCI World" },
  sp500: { symbol: "SPY", name: "S&P 500" },
  eurostoxx50: { symbol: "FEZ", name: "EURO STOXX 50" },
  dax: { symbol: "EWG", name: "DAX" },
  nasdaq100: { symbol: "QQQ", name: "NASDAQ 100" },
  msci_em: { symbol: "EEM", name: "MSCI Emerging Markets" },
};

// Helper: call Alpha Vantage
async function avFetch(params) {
  const url = new URL(AV_BASE);
  url.searchParams.set("apikey", AV_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const data = await res.json();
  if (data["Error Message"]) throw new Error(data["Error Message"]);
  if (data["Note"]) throw new Error("Rate limit reached");
  return data;
}

// ─── GET /api/quotes?symbols=AAPL,MSFT,NVDA ─────────────────────
// Returns current quotes using Alpha Vantage GLOBAL_QUOTE
app.get("/api/quotes", async (req, res) => {
  try {
    const symbols = (req.query.symbols || "").split(",").filter(Boolean);
    if (symbols.length === 0) {
      return res.status(400).json({ error: "symbols parameter required" });
    }

    const results = {};

    // Alpha Vantage free tier: 25 requests/day, 5/min
    // Fetch sequentially with small delay to avoid rate limits
    for (const sym of symbols) {
      try {
        const data = await avFetch({
          function: "GLOBAL_QUOTE",
          symbol: sym,
        });

        const q = data["Global Quote"];
        if (q && q["05. price"]) {
          results[sym] = {
            symbol: sym,
            price: parseFloat(q["05. price"]),
            previousClose: parseFloat(q["08. previous close"]),
            change: parseFloat(q["09. change"]),
            changePercent: parseFloat(q["10. change percent"]),
            dayHigh: parseFloat(q["03. high"]),
            dayLow: parseFloat(q["04. low"]),
            volume: parseInt(q["06. volume"]),
            name: sym,
          };
        }

        // Small delay between requests
        if (symbols.length > 1) {
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch (e) {
        console.warn(`Quote failed for ${sym}:`, e.message);
      }
    }

    res.json({ quotes: results, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("Quote error:", err.message);
    res.status(500).json({ error: "Failed to fetch quotes", details: err.message });
  }
});

// ─── GET /api/history?symbol=AAPL&period=6M ─────────────────────
// Returns historical price data using Alpha Vantage TIME_SERIES
app.get("/api/history", async (req, res) => {
  try {
    const { symbol, period = "6M" } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: "symbol parameter required" });
    }

    // Use daily for shorter periods, weekly for longer
    const isLong = ["1J", "3J", "MAX"].includes(period);
    const fn = isLong ? "TIME_SERIES_WEEKLY" : "TIME_SERIES_DAILY";
    const seriesKey = isLong ? "Weekly Time Series" : "Time Series (Daily)";

    const data = await avFetch({
      function: fn,
      symbol,
      outputsize: "full",
    });

    const series = data[seriesKey];
    if (!series) {
      return res.json({ symbol, period, data: [] });
    }

    // Convert to array and filter by period
    const daysMap = {
      "1W": 7, "1M": 30, "3M": 90, "6M": 180,
      "1J": 365, "3J": 1095, "MAX": 3650,
    };
    const maxDays = daysMap[period] || 180;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);

    const result = Object.entries(series)
      .map(([date, vals]) => ({
        date,
        open: parseFloat(vals["1. open"]),
        high: parseFloat(vals["2. high"]),
        low: parseFloat(vals["3. low"]),
        close: parseFloat(vals["4. close"]),
        volume: parseInt(vals["5. volume"]),
      }))
      .filter((d) => new Date(d.date) >= cutoff)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ symbol, period, data: result });
  } catch (err) {
    console.error("History error:", err.message);
    res.status(500).json({ error: "Failed to fetch history", details: err.message });
  }
});

// ─── GET /api/indices?period=6M ──────────────────────────────────
// Returns historical data for world indices (ETF proxies)
app.get("/api/indices", async (req, res) => {
  try {
    const { period = "6M" } = req.query;
    const results = {};

    const isLong = ["1J", "3J", "MAX"].includes(period);
    const fn = isLong ? "TIME_SERIES_WEEKLY" : "TIME_SERIES_DAILY";
    const seriesKey = isLong ? "Weekly Time Series" : "Time Series (Daily)";

    const daysMap = {
      "1M": 30, "3M": 90, "6M": 180,
      "1J": 365, "3J": 1095, "MAX": 3650,
    };
    const maxDays = daysMap[period] || 180;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);

    // Fetch indices sequentially (rate limit)
    for (const [key, info] of Object.entries(INDEX_SYMBOLS)) {
      try {
        const data = await avFetch({
          function: fn,
          symbol: info.symbol,
          outputsize: "full",
        });

        const series = data[seriesKey];
        if (!series) continue;

        const points = Object.entries(series)
          .map(([date, vals]) => ({
            date,
            close: parseFloat(vals["4. close"]),
          }))
          .filter((d) => new Date(d.date) >= cutoff)
          .sort((a, b) => new Date(a.date) - new Date(b.date));

        if (points.length > 0) {
          const base = points[0].close;
          results[key] = {
            symbol: info.symbol,
            name: info.name,
            data: points.map((d) => ({
              date: d.date,
              close: d.close,
              returnPct: ((d.close - base) / base) * 100,
            })),
          };
        }

        // Delay between requests
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        console.warn(`Index ${key} failed:`, e.message);
      }
    }

    res.json({ indices: results, period, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("Indices error:", err.message);
    res.status(500).json({ error: "Failed to fetch indices", details: err.message });
  }
});

// ─── GET /api/news?tickers=AAPL,MSFT ────────────────────────────
// Returns financial news using Alpha Vantage NEWS_SENTIMENT
app.get("/api/news", async (req, res) => {
  try {
    const tickers = (req.query.tickers || "AAPL,MSFT,NVDA")
      .split(",")
      .filter(Boolean)
      .slice(0, 5);

    const data = await avFetch({
      function: "NEWS_SENTIMENT",
      tickers: tickers.join(","),
      limit: "15",
      sort: "LATEST",
    });

    const feed = data.feed || [];
    const news = feed.map((item) => ({
      title: item.title,
      link: item.url,
      publisher: item.source,
      publishedAt: item.time_published
        ? formatAvDate(item.time_published)
        : null,
      summary: item.summary,
      sentiment: item.overall_sentiment_label,
      sentimentScore: item.overall_sentiment_score,
      relatedTickers: (item.ticker_sentiment || []).map((t) => t.ticker),
      thumbnail: item.banner_image || null,
    }));

    res.json({ news, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("News error:", err.message);
    res.status(500).json({ error: "Failed to fetch news", details: err.message });
  }
});

// Format Alpha Vantage date string "20261215T120000" to ISO
function formatAvDate(str) {
  if (!str || str.length < 8) return null;
  const y = str.slice(0, 4);
  const m = str.slice(4, 6);
  const d = str.slice(6, 8);
  const h = str.slice(9, 11) || "00";
  const min = str.slice(11, 13) || "00";
  return `${y}-${m}-${d}T${h}:${min}:00Z`;
}

// Export as Firebase Function
exports.api = functions.https.onRequest(app);
