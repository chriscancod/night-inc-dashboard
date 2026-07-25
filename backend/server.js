require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 4100;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── mambru-backend client — logs in once, caches the JWT, re-auths on 401.
// Distinct from this dashboard's own DASHBOARD_PASSWORD gate below: that one
// protects the dashboard operator's browser session, this one authenticates
// dashboard/backend itself as a mambru API client. ─────────────────────────
const MAMBRU_URL = process.env.MAMBRU_URL || 'http://localhost:4200';
let mambruToken = null;

async function mambruLogin() {
  const r = await fetch(`${MAMBRU_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: process.env.MAMBRU_DASHBOARD_PASSWORD }),
  });
  if (!r.ok) throw new Error(`mambru login failed: HTTP ${r.status}`);
  const data = await r.json();
  return data.token;
}

async function mambruFetch(path, opts = {}) {
  if (!mambruToken) mambruToken = await mambruLogin();
  let res = await fetch(`${MAMBRU_URL}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${mambruToken}` },
  });
  if (res.status === 401) {
    mambruToken = await mambruLogin();
    res = await fetch(`${MAMBRU_URL}${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${mambruToken}` },
    });
  }
  return res;
}

// ── Square — real purchase stats, reusing cungus's Square account ────────────
let _square = null;
function getSquareClient() {
  if (!_square) {
    if (!process.env.SQUARE_ACCESS_TOKEN) throw new Error('SQUARE_ACCESS_TOKEN not set');
    const { SquareClient, SquareEnvironment } = require('square');
    _square = new SquareClient({
      token: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENV === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
    });
  }
  return _square;
}

function buildDailyTrend(payments, days) {
  const buckets = {};
  for (let i = days - 1; i >= 0; i--) {
    buckets[new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)] = 0;
  }
  for (const p of payments) {
    const d = (p.createdAt || '').slice(0, 10);
    if (d in buckets) buckets[d] += Number(p.amountMoney?.amount || 0);
  }
  return Object.entries(buckets).map(([date, cents]) => ({ date, cents }));
}

function mockPurchaseStats() {
  const dailyTrend = Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
    cents: Math.round(4000 + Math.random() * 12000),
  }));
  return {
    currency: 'USD',
    last30DaysRevenueCents: dailyTrend.reduce((s, d) => s + d.cents, 0) * 2,
    last30DaysOrderCount: 47,
    todayRevenueCents: dailyTrend[dailyTrend.length - 1].cents,
    dailyTrend,
    recentOrders: [],
  };
}

async function getPurchaseStats() {
  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return { source: 'mock', note: 'Set SQUARE_ACCESS_TOKEN to pull real cungus store sales here.', ...mockPurchaseStats() };
  }
  try {
    const square = getSquareClient();
    const since  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const page = await square.payments.list({
      beginTime:  since.toISOString(),
      endTime:    new Date().toISOString(),
      locationId: process.env.SQUARE_LOCATION_ID || undefined,
      sortOrder:  'DESC',
    });

    const payments = [];
    for await (const payment of page) {
      payments.push(payment);
      if (payments.length >= 500) break;
    }

    const completed  = payments.filter(p => p.status === 'COMPLETED');
    const totalCents = completed.reduce((sum, p) => sum + Number(p.amountMoney?.amount || 0), 0);
    const today       = new Date().toISOString().slice(0, 10);
    const todayCents  = completed
      .filter(p => (p.createdAt || '').slice(0, 10) === today)
      .reduce((sum, p) => sum + Number(p.amountMoney?.amount || 0), 0);

    return {
      source: 'live',
      currency: completed[0]?.amountMoney?.currency || 'USD',
      last30DaysRevenueCents: totalCents,
      last30DaysOrderCount: completed.length,
      todayRevenueCents: todayCents,
      dailyTrend: buildDailyTrend(completed, 14),
      recentOrders: completed.slice(0, 8).map(p => ({
        id: p.id,
        amountCents: Number(p.amountMoney?.amount || 0),
        currency: p.amountMoney?.currency || 'USD',
        createdAt: p.createdAt,
        status: p.status,
      })),
    };
  } catch (err) {
    console.error('Square stats error:', err.message);
    return { source: 'mock', note: `Square fetch failed (${err.message}) — showing mock data.`, ...mockPurchaseStats() };
  }
}

// ── App Store downloads — not wired up yet, clearly-labeled mock ─────────────
function genDailyCounts(min, max) {
  return Array.from({ length: 14 }, (_, i) => ({
    date: new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
    count: Math.round(min + Math.random() * (max - min)),
  }));
}

function getDownloadStats() {
  const hasAppStoreCreds = !!(process.env.APPSTORE_ISSUER_ID && process.env.APPSTORE_KEY_ID && process.env.APPSTORE_PRIVATE_KEY_PATH);
  if (hasAppStoreCreds) {
    // App Store Connect API (Sales and Reports) requires a JWT signed with an
    // ES256 private key and returns gzipped TSV reports, not simple JSON — not
    // implemented here since no credentials exist yet. Wire it up in this
    // branch once APPSTORE_* env vars are set.
  }
  return {
    source: 'mock',
    note: 'Connect an App Store Connect API key (Sales and Reports access) to replace with real download counts.',
    apps: [
      { app: 'carspootz', totalDownloads: 1240, last30Days: 186, dailyTrend: genDailyCounts(8, 22) },
      { app: 'Bettermade', totalDownloads: 860, last30Days: 94, dailyTrend: genDailyCounts(3, 12) },
    ],
  };
}

// ── carspootz (Veynor) leaderboard — real, public, read-only API ─────────────
const CARSPOOTZ_API_BASE = process.env.CARSPOOTZ_API_BASE || 'https://veynor-background-production.up.railway.app';

function mockLeaderboardEntries() {
  return [
    { rank: 1, handle: 'nightowl', spots: 34, xp: 1200, level: 5 },
    { rank: 2, handle: 'redline', spots: 27, xp: 980, level: 4 },
    { rank: 3, handle: 'apex_gt', spots: 19, xp: 740, level: 3 },
  ];
}

async function getCarspootzLeaderboard() {
  try {
    const monthlyRes = await fetch(`${CARSPOOTZ_API_BASE}/api/leaderboard/monthly`, { timeout: 8000 });
    if (monthlyRes.ok) {
      const data = await monthlyRes.json();
      return { source: 'live', period: 'monthly', entries: data.entries || [] };
    }
    // Monthly endpoint isn't deployed on the carspootz backend yet — fall back
    // to the real all-time leaderboard instead of fabricating monthly numbers.
    const topRes = await fetch(`${CARSPOOTZ_API_BASE}/api/leaderboard/top`, { timeout: 8000 });
    if (!topRes.ok) throw new Error(`status ${topRes.status}`);
    const data = await topRes.json();
    return {
      source: 'live',
      period: 'all-time',
      note: 'The carspootz backend has no /api/leaderboard/monthly route deployed yet — showing the real all-time leaderboard instead.',
      entries: (data.entries || []).map(e => ({ rank: e.rank, handle: e.handle, spots: e.spots, xp: e.xp, level: e.level })),
    };
  } catch (err) {
    console.error('carspootz leaderboard error:', err.message);
    return { source: 'mock', period: 'monthly', note: `carspootz API unreachable (${err.message}) — showing mock data.`, entries: mockLeaderboardEntries() };
  }
}

// ── Bettermade engagement — no server-side tracking exists in the app yet ────
function getBettermadeEngagement() {
  return {
    source: 'mock',
    note: 'Bettermade ships with zero accounts and all data local-only by design, so there is no server-side engagement signal to show yet. Real numbers would need an opt-in anonymous device-id + sync, mirroring how carspootz tracks handles.',
    modules: [
      { module: 'Kinetic', metric: 'workouts logged', last30Days: 312 },
      { module: 'Index', metric: 'lessons completed', last30Days: 480 },
      { module: 'Apex', metric: 'quests completed', last30Days: 275 },
      { module: 'Nexus', metric: 'AI chats', last30Days: 190 },
      { module: 'Aura', metric: 'check-ins', last30Days: 140 },
      { module: 'Wardrobe', metric: 'outfits generated', last30Days: 98 },
    ],
  };
}

// ── Claude API ─────────────────────────────────────────────────────────────
async function callClaude(system, user, maxTokens = 300) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // Defaults to Haiku 4.5 — cheapest tier, chosen for the $5/mo Railway
        // plan; this is a cached-every-10-minutes internal summary, not a
        // customer-facing feature, so the quality/cost tradeoff favors cost.
        // Override with CLAUDE_DEFAULT_MODEL if quality ever disappoints.
        model: process.env.CLAUDE_DEFAULT_MODEL || 'claude-haiku-4-5',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      console.error('Claude API error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('Claude API call failed:', err.message);
    return null;
  }
}

// ── Connections — live status of every Night.inc property this dashboard
// unifies, checked by actually pinging each one's real deployed backend ─────
const CONNECTIONS = [
  { key: 'cungus', name: '2AM Store', url: 'https://cungus-production.up.railway.app/' },
  { key: 'carspootz', name: 'carspootz (Veynor)', url: `${CARSPOOTZ_API_BASE}/` },
  { key: 'bettermade', name: 'Bettermade', url: process.env.BETTERMADE_API_BASE || 'https://apex-backend-production-5cec.up.railway.app/' },
];

async function getConnections() {
  const services = await Promise.all(CONNECTIONS.map(async (c) => {
    try {
      const res  = await fetch(c.url, { timeout: 6000 });
      const body = await res.json().catch(() => ({}));
      return { ...c, status: res.ok ? 'online' : 'degraded', detail: body.status || body.service || `HTTP ${res.status}` };
    } catch (err) {
      return { ...c, status: 'offline', detail: err.message };
    }
  }));
  return { checkedAt: new Date().toISOString(), services };
}

// ── Password gate — every /api/* route below requires DASHBOARD_PASSWORD
// (sent as the x-dashboard-password header) once it's set. Unset = open,
// which only happens in local dev; the README calls this out. ──────────────
function requireAuth(req, res, next) {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return next();
  if (req.get('x-dashboard-password') === pw) return next();
  return res.status(401).json({ error: 'Unauthorized — wrong or missing dashboard password.' });
}

app.post('/api/auth/check', (req, res) => {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) return res.json({ ok: true, protected: false });
  if ((req.body || {}).password === pw) return res.json({ ok: true, protected: true });
  return res.status(401).json({ ok: false, protected: true });
});
app.use('/api', requireAuth);

// ── Routes ─────────────────────────────────────────────────────────────────
app.get('/', (_, res) => res.json({ status: 'ok', service: 'nighthq-dashboard-backend', version: '1.0.0' }));

app.get('/api/connections', async (req, res) => res.json(await getConnections()));
app.get('/api/stats/purchases', async (req, res) => res.json(await getPurchaseStats()));
app.get('/api/stats/downloads', (req, res) => res.json(getDownloadStats()));
app.get('/api/stats/leaderboard/carspootz', async (req, res) => res.json(await getCarspootzLeaderboard()));
app.get('/api/stats/engagement/bettermade', (req, res) => res.json(getBettermadeEngagement()));

app.get('/api/stats/all', async (req, res) => {
  const [purchases, leaderboard] = await Promise.all([getPurchaseStats(), getCarspootzLeaderboard()]);
  res.json({
    purchases,
    downloads: getDownloadStats(),
    carspootzLeaderboard: leaderboard,
    bettermadeEngagement: getBettermadeEngagement(),
    generatedAt: new Date().toISOString(),
  });
});

let insightsCache = { text: null, ts: 0, generatedWith: null };
app.get('/api/insights', async (req, res) => {
  const now = Date.now();
  if (insightsCache.text && now - insightsCache.ts < 10 * 60 * 1000) {
    return res.json({ insight: insightsCache.text, generatedWith: insightsCache.generatedWith, cached: true });
  }
  const [purchases, leaderboard] = await Promise.all([getPurchaseStats(), getCarspootzLeaderboard()]);
  const downloads = getDownloadStats();
  const summaryInput = {
    revenueLast30DaysUSD: (purchases.last30DaysRevenueCents / 100).toFixed(2),
    orders30d: purchases.last30DaysOrderCount,
    revenueSource: purchases.source,
    topSpotter: leaderboard.entries?.[0]?.handle || 'n/a',
    topSpots: leaderboard.entries?.[0]?.spots ?? leaderboard.entries?.[0]?.xp ?? 0,
    downloadsSource: downloads.source,
    carspootzLast30DaysDownloads: downloads.apps.find(a => a.app === 'carspootz')?.last30Days,
    bettermadeLast30DaysDownloads: downloads.apps.find(a => a.app === 'Bettermade')?.last30Days,
  };
  const text = await callClaude(
    'You are a terse ops analyst writing a two-sentence dashboard summary for an indie founder running one streetwear store and two iOS apps. Be specific and direct, mention at least one real number. No markdown, no emoji, no hype.',
    `This period's data as JSON: ${JSON.stringify(summaryInput)}. Write the summary.`
  );
  const insight = text || 'AI summary unavailable — set ANTHROPIC_API_KEY on the backend to enable Claude-generated insights here.';
  insightsCache = { text: insight, ts: now, generatedWith: text ? 'claude' : 'fallback' };
  res.json({ insight, generatedWith: insightsCache.generatedWith, cached: false });
});

// ── Coupons/sales — proxied through mambru-backend, the source of truth for
// real coupons/sales now (superseded the old winners.json monthly-coupon
// hack, which minted an arbitrary code from the carspootz leaderboard rather
// than a redeemable one) ─────────────────────────────────────────────────
app.get('/api/coupons/active', async (req, res) => {
  const r = await mambruFetch(`/api/coupons/active${req.query.app ? `?app=${req.query.app}` : ''}`);
  res.status(r.status).json(await r.json());
});

app.post('/api/coupons/create', async (req, res) => {
  const r = await mambruFetch('/api/coupons/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body),
  });
  res.status(r.status).json(await r.json());
});

app.get('/api/coupons/stats', async (req, res) => {
  const r = await mambruFetch('/api/coupons/stats');
  res.status(r.status).json(await r.json());
});

app.get('/api/sales/recent', async (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  const r = await mambruFetch(`/api/sales/recent${qs ? `?${qs}` : ''}`);
  res.status(r.status).json(await r.json());
});

app.get('/api/sales/stats', async (req, res) => {
  const r = await mambruFetch('/api/sales/stats');
  res.status(r.status).json(await r.json());
});

app.get('/api/stats/mambru', async (req, res) => {
  const r = await mambruFetch('/api/stats/dashboard');
  res.status(r.status).json(await r.json());
});

app.listen(PORT, () => console.log(`nighthq-dashboard-backend listening on :${PORT}`));
