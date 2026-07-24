require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 4100;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── Winner/coupon persistence (same pattern as cungus/backend/data) ──────────
const DATA_DIR     = path.join(__dirname, 'data');
const WINNERS_FILE = path.join(DATA_DIR, 'winners.json');

function loadWinners() {
  try { return JSON.parse(fs.readFileSync(WINNERS_FILE, 'utf8')); }
  catch (e) { return []; }
}
function saveWinners(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WINNERS_FILE, JSON.stringify(list, null, 2));
}

function currentMonthKey(d = new Date()) {
  return d.toISOString().slice(0, 7); // YYYY-MM
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
        model: 'claude-sonnet-5',
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

function generateCouponCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${seg}-${Math.floor(100 + Math.random() * 900)}`;
}

// Determines (and persists) this month's winner + a Claude-written coupon
// message. Idempotent per app+month so repeat calls/polling don't regenerate
// a new code every time.
app.get('/api/coupon/monthly-winner/:app', async (req, res) => {
  const appKey   = req.params.app.toLowerCase();
  const monthKey = currentMonthKey();
  const winners  = loadWinners();
  const existing = winners.find(w => w.app === appKey && w.month === monthKey);
  if (existing) return res.json(existing);

  if (appKey !== 'carspootz') {
    return res.status(501).json({
      error: `${req.params.app} has no server-side leaderboard yet, so there is nothing to fairly pick a winner from.`,
      note: 'See /api/stats/engagement/bettermade for what would need to exist first.',
    });
  }

  const board = await getCarspootzLeaderboard();
  const top = board.entries?.[0];
  if (!top) return res.status(404).json({ error: 'No leaderboard data available yet.' });

  const code = generateCouponCode('SPOT');
  const winnerHandle = top.handle;
  const metricValue  = top.spots ?? top.xp ?? 0;
  const metricLabel  = top.spots != null ? 'car spots' : 'XP';

  const message = await callClaude(
    'You write one-sentence, upbeat but not cheesy coupon-reveal announcements for the top player on an indie car-spotting app leaderboard. No markdown, no emoji.',
    `Winner handle: "${winnerHandle}". This period's total: ${metricValue} ${metricLabel}. Coupon code: ${code}.`
  ) || `Congrats @${winnerHandle} — top of the board with ${metricValue} ${metricLabel} this month! Use code ${code} for 20% off at the 2AM store.`;

  const record = {
    app: appKey,
    month: monthKey,
    winnerHandle,
    metricLabel,
    metricValue,
    code,
    message,
    leaderboardSource: board.source,
    leaderboardPeriod: board.period,
    generatedAt: new Date().toISOString(),
  };
  winners.push(record);
  saveWinners(winners);
  res.json(record);
});

app.get('/api/coupon/winners', (req, res) => res.json({ winners: loadWinners() }));

app.listen(PORT, () => console.log(`nighthq-dashboard-backend listening on :${PORT}`));
