# This backend is dead. Don't deploy it.

`dashboard/live.html` talks straight to **mega-backend-production.up.railway.app**.
Its stats routes were folded into the mega backend back in Milestone 5, and
nothing has pointed at this service since.

Checked 2026-08-14:

- `live.html`'s `DASH_CONFIG.BACKEND_URL` → the mega backend, not this.
- `dashboard/` is not linked to any Railway project, so this isn't running.
- `backend/.env` is correctly gitignored, so the secrets in it were never
  committed.

## Why it's still here

Deleting it would throw away a working reference for how the dashboard's auth
and Square/Anthropic calls were originally wired, and nothing is currently
harmed by it sitting on disk.

## Why you should not revive it

`.env` in this folder holds **real production credentials** — a Square access
token, an Anthropic API key, and the old dashboard password. Deploying this
would put a second, unmaintained service on the internet holding live keys,
with none of the protections the mega backend has picked up since:

- no rate limiting on the AI routes (the mega backend now has per-device caps
  and a global daily budget)
- no `trust proxy`, so any limiter added here would silently not work
- no `pool.on('error')` or unhandled-rejection guards, so a DB blip kills it
- the old `DASHBOARD_PASSWORD` gate instead of the JWT auth in use now

If you ever need something from here, port the idea into `mambru-backend` —
don't start this process.

## If you want it properly gone

```bash
rm -rf dashboard/backend
```

The credentials in `.env` should be rotated at some point regardless, since
they've sat in a folder nobody is watching.
