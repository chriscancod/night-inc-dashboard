/* nighthq live dashboard — polls the unified backend and renders stat
   panels. No build step, no framework — matches the rest of the portfolio. */

const CONFIG = window.DASH_CONFIG || { BACKEND_URL: 'http://localhost:4200' };
const REFRESH_MS = 60000;
const TOKEN_KEY = 'nighthq_dash_token';

function $(sel) { return document.querySelector(sel); }

async function fetchJSON(path, opts = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showAuthGate(); throw new Error('Unauthorized'); }
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

// ── password gate ────────────────────────────────────────────────────────
function showAuthGate() {
  const gate = document.getElementById('auth-gate');
  const content = document.getElementById('dashboard-content');
  if (gate) gate.style.display = 'flex';
  if (content) content.style.display = 'none';
}

function hideAuthGate() {
  const gate = document.getElementById('auth-gate');
  const content = document.getElementById('dashboard-content');
  if (gate) gate.style.display = 'none';
  if (content) content.style.display = 'block';
}

// Logs in against the mega backend's shared JWT auth (routes/auth.js) —
// email is omitted so the server defaults to its own ADMIN_EMAIL, keeping
// this a single-password login like before, just token-based now instead of
// resending the raw password on every request.
async function login(password) {
  const res = await fetch(`${CONFIG.BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.success ? data.token : null;
}

async function verifyToken(token) {
  const res = await fetch(`${CONFIG.BACKEND_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  return !!data.valid;
}

async function initAuth() {
  const stored = sessionStorage.getItem(TOKEN_KEY);
  if (stored && await verifyToken(stored)) {
    hideAuthGate();
    startDashboard();
    return;
  }
  sessionStorage.removeItem(TOKEN_KEY);
  showAuthGate();

  const submit = document.getElementById('auth-submit');
  const input  = document.getElementById('auth-input');
  const error  = document.getElementById('auth-error');
  if (!submit || !input) return;

  const attempt = async () => {
    const token = await login(input.value);
    if (token) {
      sessionStorage.setItem(TOKEN_KEY, token);
      error.style.display = 'none';
      hideAuthGate();
      startDashboard();
    } else {
      error.style.display = 'block';
    }
  };
  submit.addEventListener('click', attempt);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });
}

function fmtMoney(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}

function fmtNum(n) {
  return new Intl.NumberFormat('en-US').format(n || 0);
}

function badge(source) {
  return source === 'live'
    ? `<span class="badge live">Live</span>`
    : `<span class="badge mock">Mock</span>`;
}

function sparkline(points, valueKey) {
  const values = points.map(p => p[valueKey]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const w = 280, h = 40;
  const step = w / Math.max(points.length - 1, 1);
  const coords = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * h;
    return [x, y];
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const fill = `${line} L${w},${h} L0,${h} Z`;
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <path class="fill" d="${fill}"></path>
    <path d="${line}"></path>
  </svg>`;
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

async function loadConnections() {
  try {
    const d = await fetchJSON('/api/connections');
    const tiles = d.services.map(s => `
      <div class="conn-tile">
        <span class="conn-dot ${s.status}"></span>
        <div>
          <div class="conn-name">${s.name}</div>
          <div class="conn-detail">${s.status} · ${s.detail}</div>
        </div>
      </div>
    `).join('');
    setHTML('connections-panel', `
      <div class="panel-head"><div class="panel-title">Connected Properties</div></div>
      <div class="conn-grid">${tiles}</div>
    `);
  } catch (e) {
    setHTML('connections-panel', `<div class="err">Connection status unavailable.</div>`);
  }
}

async function loadInsight() {
  try {
    const data = await fetchJSON('/api/insights');
    setHTML('insight-panel', `
      <div class="insight-banner">
        <div class="glyph">AI</div>
        <div>
          <p>${data.insight}</p>
          <div class="meta">${data.generatedWith === 'claude' ? 'Generated by Claude' : 'Fallback summary'} · refreshes every 10 min</div>
        </div>
      </div>
    `);
  } catch (e) {
    setHTML('insight-panel', `<div class="err">Insight unavailable — backend unreachable.</div>`);
  }
}

async function loadPurchases() {
  try {
    const d = await fetchJSON('/api/stats/purchases');
    setHTML('purchases-panel', `
      <div class="panel-head">
        <div class="panel-title">Purchases — 2AM Store</div>
        ${badge(d.source)}
      </div>
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-label">Last 30 Days</div>
          <div class="stat-value">${fmtMoney(d.last30DaysRevenueCents, d.currency)}</div>
          <div class="stat-sub">${fmtNum(d.last30DaysOrderCount)} orders</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Today</div>
          <div class="stat-value">${fmtMoney(d.todayRevenueCents, d.currency)}</div>
        </div>
        <div class="stat-tile" style="grid-column:span 2">
          <div class="stat-label">14-Day Trend</div>
          ${sparkline(d.dailyTrend, 'cents')}
        </div>
      </div>
      ${d.note ? `<div class="panel-note">${d.note}</div>` : ''}
    `);
  } catch (e) {
    setHTML('purchases-panel', `<div class="err">Purchase stats unavailable.</div>`);
  }
}

async function loadDownloads() {
  try {
    const d = await fetchJSON('/api/stats/downloads');
    const cards = d.apps.map(app => `
      <div class="stat-tile">
        <div class="stat-label">${app.app}</div>
        <div class="stat-value">${fmtNum(app.totalDownloads)}</div>
        <div class="stat-sub">${fmtNum(app.last30Days)} in last 30 days</div>
        ${sparkline(app.dailyTrend, 'count')}
      </div>
    `).join('');
    setHTML('downloads-panel', `
      <div class="panel-head">
        <div class="panel-title">App Downloads</div>
        ${badge(d.source)}
      </div>
      <div class="stat-grid">${cards}</div>
      ${d.note ? `<div class="panel-note">${d.note}</div>` : ''}
    `);
  } catch (e) {
    setHTML('downloads-panel', `<div class="err">Download stats unavailable.</div>`);
  }
}

function buildStateColor(state) {
  if (state === 'VALID') return 'var(--green)';
  if (state === 'PROCESSING') return 'var(--amber)';
  if (state === 'FAILED' || state === 'INVALID') return 'var(--red)';
  return 'var(--muted-dim)';
}

async function loadTestFlight() {
  try {
    const d = await fetchJSON('/api/stats/testflight');
    const cards = d.apps.map(app => {
      if (app.error) return `<div class="stat-tile"><div class="stat-label">${app.app}</div><div class="panel-note" style="margin:8px 0 0;padding:0;border:none">${app.error}</div></div>`;
      const build = app.latestBuild;
      const buildLine = build && !build.error
        ? `Build ${build.version} · <span style="color:${buildStateColor(build.processingState)}">${build.processingState}</span>`
        : 'No builds yet';
      const uploaded = build?.uploadedDate ? new Date(build.uploadedDate).toLocaleDateString() : '—';
      return `
        <div class="stat-tile">
          <div class="stat-label">${app.app}</div>
          <div class="stat-value">${fmtNum(app.betaTesters)}</div>
          <div class="stat-sub">beta testers</div>
          <div class="stat-sub" style="margin-top:8px">${buildLine}</div>
          <div class="stat-sub">Uploaded ${uploaded}</div>
        </div>
      `;
    }).join('');
    setHTML('testflight-panel', `
      <div class="panel-head">
        <div class="panel-title">TestFlight</div>
        ${badge(d.source)}
      </div>
      <div class="stat-grid">${cards}</div>
      ${d.note ? `<div class="panel-note">${d.note}</div>` : ''}
    `);
  } catch (e) {
    setHTML('testflight-panel', `<div class="err">TestFlight status unavailable.</div>`);
  }
}

async function loadLoyalty() {
  try {
    const d = await fetchJSON('/api/stats/loyalty');
    const tierRows = d.by_tier.map(t => `
      <div class="mini-row"><span class="k">${t.tier}</span><span class="v">${fmtNum(t.accounts)}</span></div>
    `).join('') || `<div class="skel">No accounts yet.</div>`;
    setHTML('loyalty-panel', `
      <div class="panel-head">
        <div class="panel-title">Loyalty &amp; Rewards</div>
        ${badge('live')}
      </div>
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-label">Accounts</div>
          <div class="stat-value">${fmtNum(d.total_accounts)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Points Outstanding</div>
          <div class="stat-value">${fmtNum(d.points_outstanding)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Rewards Minted</div>
          <div class="stat-value">${fmtNum(d.rewards_minted)}</div>
          <div class="stat-sub">${fmtNum(d.rewards_redeemed)} redeemed · ${fmtMoney(d.reward_value_minted * 100)} value</div>
        </div>
      </div>
      <div style="margin-top:14px">${tierRows}</div>
    `);
  } catch (e) {
    setHTML('loyalty-panel', `<div class="err">Loyalty stats unavailable.</div>`);
  }
}

async function loadComms() {
  try {
    const d = await fetchJSON('/api/stats/comms');
    const sentByChannel = {};
    for (const row of d.by_channel) {
      if (row.status !== 'sent') continue;
      sentByChannel[row.channel] = (sentByChannel[row.channel] || 0) + row.count;
    }
    const channelRows = ['email', 'chat', 'sms'].map(ch => `
      <div class="mini-row"><span class="k">${ch}</span><span class="v">${fmtNum(sentByChannel[ch] || 0)}</span></div>
    `).join('');
    const templateRows = d.by_template.map(t => `
      <div class="mini-row"><span class="k">${t.template}</span><span class="v">${fmtNum(t.count)}</span></div>
    `).join('') || `<div class="skel">No sends yet.</div>`;
    const recentRows = d.recent.map(r => `
      <div class="mini-row"><span class="k">${r.channel} · ${r.template}${r.recipient ? ` → ${r.recipient}` : ''}</span><span class="v">${r.status === 'sent' ? '✓' : r.status === 'failed' ? '✕' : '—'} ${new Date(r.created_at).toLocaleString()}</span></div>
    `).join('') || `<div class="skel">Nothing logged yet.</div>`;
    const smsConfigured = sentByChannel.sms !== undefined || d.by_channel.some(r => r.channel === 'sms' && r.status === 'sent');
    setHTML('comms-panel', `
      <div class="panel-head">
        <div class="panel-title">Omnichannel Comms</div>
        ${badge('live')}
      </div>
      <div class="stat-grid">
        <div class="stat-tile">
          <div class="stat-label">Email Sent</div>
          <div class="stat-value">${fmtNum(sentByChannel.email || 0)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Chat Replies</div>
          <div class="stat-value">${fmtNum(sentByChannel.chat || 0)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">SMS</div>
          <div class="stat-value">${fmtNum(sentByChannel.sms || 0)}</div>
          <div class="stat-sub">${smsConfigured ? 'sent' : 'no Twilio account yet'}</div>
        </div>
      </div>
      <div style="margin-top:14px">${templateRows}</div>
      <div style="margin-top:14px;opacity:.8;font-size:12px">${recentRows}</div>
    `);
  } catch (e) {
    setHTML('comms-panel', `<div class="err">Comms stats unavailable.</div>`);
  }
}

async function loadLeaderboard() {
  try {
    const d = await fetchJSON('/api/stats/leaderboard/carspootz');
    const rows = (d.entries || []).slice(0, 8).map((e, i) => `
      <tr class="${i === 0 ? 'rank-1' : ''}">
        <td><span class="rank-pip ${i === 0 ? 'gold' : ''}">${e.rank ?? i + 1}</span></td>
        <td>@${e.handle}</td>
        <td>${fmtNum(e.spots ?? 0)}</td>
        <td>${fmtNum(e.xp ?? 0)}</td>
      </tr>
    `).join('') || `<tr><td colspan="4" class="skel">No entries yet.</td></tr>`;
    setHTML('leaderboard-panel', `
      <div class="panel-head">
        <div class="panel-title">carspootz Leaderboard</div>
        ${badge(d.source)}
      </div>
      <table class="board">
        <thead><tr><th>#</th><th>Handle</th><th>Spots</th><th>XP</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${d.note ? `<div class="panel-note">${d.note}</div>` : ''}
    `);
  } catch (e) {
    setHTML('leaderboard-panel', `<div class="err">Leaderboard unavailable.</div>`);
  }
}

async function loadWinner() {
  try {
    const res = await fetch(`${CONFIG.BACKEND_URL}/api/coupon/monthly-winner/carspootz`, {
      headers: { authorization: `Bearer ${sessionStorage.getItem(TOKEN_KEY) || ''}` },
    });
    if (res.status === 404) {
      setHTML('winner-panel', `<div class="panel-head"><div class="panel-title">This Month's Winner</div></div><div class="skel">No winner yet — use "Close Last Month" below to mint the first one.</div>`);
      return;
    }
    if (res.status === 401) { showAuthGate(); return; }
    if (!res.ok) throw new Error(`winner → ${res.status}`);
    const d = await res.json();
    setHTML('winner-panel', `
      <div class="panel-head">
        <div class="panel-title">This Month's Winner — ${d.month}</div>
        <span class="badge live">@${d.winnerHandle}</span>
      </div>
      <div class="coupon">
        <div class="coupon-code">${d.code}</div>
        <div class="coupon-msg">${d.message}</div>
      </div>
      <div class="panel-note">Won with ${fmtNum(d.metricValue)} ${d.metricLabel} · leaderboard source: ${d.leaderboardSource} (${d.leaderboardPeriod})</div>
    `);
  } catch (e) {
    setHTML('winner-panel', `<div class="err">Winner data unavailable.</div>`);
  }
}

// Manually triggered — mints a real, redeemable coupon for last month's
// carspootz leaderboard winner. Idempotent: closing an already-closed month
// just returns the existing coupon instead of minting a second one.
async function closeMonth() {
  const btn = document.getElementById('close-month-btn');
  const status = document.getElementById('close-month-status');
  if (!btn || !status) return;
  btn.disabled = true;
  status.textContent = 'Closing last month…';
  try {
    const d = await fetchJSON('/api/competitions/carspootz-monthly/close', { method: 'POST' });
    if (d.noWinner) {
      status.textContent = `No scans recorded for ${d.period} — nothing to close.`;
    } else if (d.alreadyRan) {
      status.textContent = `${d.period} was already closed — winner @${d.winner}, code ${d.code}.`;
    } else {
      status.textContent = `Closed ${d.period} — winner @${d.winner}, code ${d.code}.`;
    }
    await loadWinner();
    await loadWinnersHistory();
  } catch (e) {
    status.textContent = 'Could not close the month — check the console.';
  } finally {
    btn.disabled = false;
  }
}

async function loadWinnersHistory() {
  try {
    const d = await fetchJSON('/api/coupon/winners');
    const rows = (d.winners || []).slice().reverse().map(w => `
      <div class="mini-row">
        <span class="k">${w.month} · @${w.winnerHandle}</span>
        <span class="v">${w.code}</span>
      </div>
    `).join('') || `<div class="skel">No winners recorded yet.</div>`;
    setHTML('history-panel', `
      <div class="panel-head"><div class="panel-title">Hall of Fame</div></div>
      ${rows}
    `);
  } catch (e) {
    setHTML('history-panel', `<div class="err">History unavailable.</div>`);
  }
}

async function loadEngagement() {
  try {
    const d = await fetchJSON('/api/stats/engagement/bettermade');
    const rows = d.modules.map(m => `
      <div class="mini-row">
        <span class="k">${m.module} — ${m.metric}</span>
        <span class="v">${fmtNum(m.last30Days)}</span>
      </div>
    `).join('');
    setHTML('engagement-panel', `
      <div class="panel-head">
        <div class="panel-title">Bettermade Engagement</div>
        ${badge(d.source)}
      </div>
      ${rows}
      ${d.note ? `<div class="panel-note">${d.note}</div>` : ''}
    `);
  } catch (e) {
    setHTML('engagement-panel', `<div class="err">Engagement stats unavailable.</div>`);
  }
}

async function loadCoupons() {
  try {
    const d = await fetchJSON('/api/coupons/active');
    const rows = (d.coupons || []).map(c => {
      const amount = c.discount_type === 'percent' ? `${c.discount_value}% off` : `$${Number(c.discount_value).toFixed(2)} off`;
      const bits = [amount];
      if (c.auto_generated) bits.push('auto-generated');
      if (c.expires_at) bits.push(`expires ${new Date(c.expires_at).toLocaleDateString()}`);
      if (c.description) bits.push(c.description);
      return `
        <div class="cpn-row">
          <span class="cpn-code">${c.code}</span>
          <span class="cpn-meta">${bits.join(' · ')}</span>
        </div>
      `;
    }).join('') || `<div class="skel">No active coupons yet — create one above.</div>`;
    setHTML('cpn-list', rows);
  } catch (e) {
    setHTML('cpn-list', `<div class="err">Coupon list unavailable.</div>`);
  }
}

function randomCouponCode() {
  return 'PROMO-' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

async function createCoupon() {
  const status = document.getElementById('cpn-status');
  const btn = document.getElementById('cpn-create-btn');
  const codeInput = document.getElementById('cpn-code');
  const type = document.getElementById('cpn-type').value;
  const value = document.getElementById('cpn-value').value;
  const maxUses = document.getElementById('cpn-max-uses').value;
  const expires = document.getElementById('cpn-expires').value;
  const desc = document.getElementById('cpn-desc').value;

  if (!value || Number(value) <= 0) {
    status.textContent = 'Enter an amount greater than 0.';
    status.className = 'err';
    return;
  }

  const code = (codeInput.value.trim() || randomCouponCode()).toUpperCase();
  btn.disabled = true;
  status.textContent = 'Creating…';
  status.className = '';

  try {
    await fetchJSON('/api/coupons/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        discount_type: type,
        discount_value: Number(value),
        description: desc || undefined,
        max_uses: maxUses ? Number(maxUses) : undefined,
        // <input type=date> gives midnight local time; store as end-of-day UTC
        // so a coupon stays valid through the whole day the merchant picked.
        expires_at: expires ? new Date(expires + 'T23:59:59').toISOString() : undefined,
      }),
    });
    status.textContent = `Created ${code}.`;
    status.className = 'ok';
    codeInput.value = '';
    document.getElementById('cpn-value').value = '';
    document.getElementById('cpn-max-uses').value = '';
    document.getElementById('cpn-expires').value = '';
    document.getElementById('cpn-desc').value = '';
    await loadCoupons();
  } catch (e) {
    status.textContent = e.message.includes('409') ? `Code ${code} already exists — try another.` : 'Could not create coupon.';
    status.className = 'err';
  } finally {
    btn.disabled = false;
  }
}

function refreshAll() {
  loadConnections();
  loadInsight();
  loadPurchases();
  loadDownloads();
  loadTestFlight();
  loadLoyalty();
  loadComms();
  loadLeaderboard();
  loadWinner();
  loadWinnersHistory();
  loadEngagement();
  loadCoupons();
  const stamp = document.getElementById('last-updated');
  if (stamp) stamp.textContent = `Last updated ${new Date().toLocaleTimeString()}`;
}

function startDashboard() {
  refreshAll();
  setInterval(refreshAll, REFRESH_MS);
  const closeBtn = document.getElementById('close-month-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeMonth);
  const cpnBtn = document.getElementById('cpn-create-btn');
  if (cpnBtn) cpnBtn.addEventListener('click', createCoupon);
}

document.addEventListener('DOMContentLoaded', initAuth);
