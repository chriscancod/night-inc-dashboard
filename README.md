# Night.inc — Studio Portfolio + Live Dashboard

A portfolio site for the studio (2AM, carspootz, Bettermade, Night Phone) plus
a password-protected, real-time ops dashboard backed by a unified Express
server.

## Stack
- **Frontend** `index.html` (portfolio) + `live.html` (dashboard) — vanilla
  HTML/CSS/JS, no build step, same design-system pattern as the cungus store
  (`shared/style.css` + `shared/dashboard.js`).
- **Backend** `backend/server.js` — Node/Express. Aggregates data from every
  property into one API instead of the frontend hitting each service
  directly.

## What's real vs. mock right now
| Panel | Source | Status |
|---|---|---|
| Connected Properties | Live pings to cungus, carspootz, and Bettermade's actual deployed backends | **Real** |
| carspootz Leaderboard + Monthly Winner | carspootz's live public API (`/api/leaderboard/top`, with `/api/leaderboard/monthly` used automatically once that route exists on their backend) | **Real** |
| 2AM Store Purchases | Square Payments API, once `SQUARE_ACCESS_TOKEN`/`SQUARE_LOCATION_ID` are set (reuse the same credentials as `cungus/backend/.env`) | **Real once configured**, mock otherwise |
| App Downloads | — | **Mock** — needs an App Store Connect API key (Sales and Reports access); see `.env.example` |
| Bettermade Engagement | — | **Mock** — Bettermade ships with zero accounts and all data on-device by design, so there's no server-side signal to show yet |
| AI Insight banner | Claude (Anthropic API) | **Real once `ANTHROPIC_API_KEY` is set**, falls back to a static line otherwise |
| Monthly winner coupon message | Claude | **Real once `ANTHROPIC_API_KEY` is set**, falls back to a template message otherwise |

Every mock panel is explicitly labeled `MOCK` in the UI (vs. `LIVE`) — nothing
fake is presented as real.

## Setup

```bash
cd backend
npm install
cp .env.example .env
# fill in the values you have — everything degrades gracefully if left blank
node server.js
# http://localhost:4100
```

Then open `index.html` / `live.html` directly, or serve the folder statically.
`live.html`'s inline `DASH_CONFIG.BACKEND_URL` points at `http://localhost:4100`
by default — update it to your deployed backend URL before going live (same
pattern as cungus's frontend `CONFIG.BACKEND_URL`).

### Password protection
Set `DASHBOARD_PASSWORD` in `backend/.env` to anything you want — the backend
rejects every `/api/*` request without the matching `x-dashboard-password`
header, so this is enforced server-side, not just a UI overlay. Leaving it
blank disables the gate (only fine for local dev). Pick a password you don't
reuse elsewhere; it's sent in a request header, not stored anywhere except
your browser's `sessionStorage` for the current tab session.

### Coupons / monthly winners
`GET /api/coupon/monthly-winner/carspootz` picks the current top scanner from
the live leaderboard, generates a code + a Claude-written message, and
persists it to `backend/data/winners.json` (idempotent per month — calling it
again just returns the same record). There's currently no equivalent for
Bettermade or a way to redeem these codes in the 2AM checkout — see below.

### Deploy
Same flow as `cungus/backend`: push `backend/` to Railway (root directory =
`backend`, add the env vars in Settings → Variables), deploy `index.html` /
`live.html` / `shared/` as static files (GitHub Pages or wherever), then
update `DASH_CONFIG.BACKEND_URL` in `live.html` to the Railway URL.

## Known gaps / what would need more access to finish
- **Claude-powering the apps themselves** (carspootz's car-ID vision call,
  Bettermade's GPT-4o chat/coach features) — those live in separate Railway
  backends (`veynor-background`, and the "Night.inc Unified Backend" behind
  Bettermade) that aren't in this workspace. Swapping their model provider
  means editing that source directly; this dashboard only reads their public
  APIs, it doesn't touch their internals.
- **Bettermade monthly winner** — there's no leaderboard to pick one from
  until Bettermade adds an opt-in anonymous device-id + an engagement
  counter synced to a backend, mirroring how carspootz already tracks
  handles/spots.
- **Real App Store download counts** — needs a paid Apple Developer account's
  App Store Connect API key (Sales and Reports access); the fetch/JWT-signing
  logic isn't implemented since there's nothing to authenticate with yet.
- **Redeeming winner coupons at checkout** — cungus's checkout only validates
  `WARDROBE-*` codes tied to a specific purchased item today, not general
  percent-off codes; wiring these into checkout is a `cungus/backend/server.js`
  change, not something this dashboard project touches.
