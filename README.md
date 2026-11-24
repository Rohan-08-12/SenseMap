# SenseMap

**Find places that feel right for you.**

SenseMap is a community-powered sensory map helping autistic and sensory-sensitive individuals discover comfortable public spaces. Places show noise, lighting, and crowd scores from visitor reviews or, until there are reviews, from AI estimates (Google Gemini) built from public text about the place. SenseMap is honest by design: every score says where it comes from, most scores are AI estimates until visitors add reviews, and a place without enough evidence shows **"Not enough data yet"** instead of an invented number.

Currently in beta, covering **Toronto**.

---

## What it does

- **Interactive map** — color-coded pins and heatmap showing sensory comfort at a glance
- **Sensory scores where there is evidence** — noise, lighting, and crowd on a 0.5–5 scale. Scores come from visitor reviews, or from AI estimates when there are none (Yelp + Foursquare + Google Places + City of Toronto text → Gemini 2.5-flash, run nightly). Community reviews progressively take over. Places with neither show "Not enough data yet" and are left off rankings and the heatmap.
- **Data transparency** — every score is labelled with its source: community reviews or AI estimate
- **AI insights** — Gemini 2.5-flash analyzes reviews and surfaces noise patterns, best visit times, and sensory tags
- **Personalized matching** — set your own noise/lighting/crowd tolerance and get a % match for every location
- **Review list** — see individual reviews with author, date, and slider ratings; AI-seeded reviews labeled with a badge
- **Check-in flow** — quick tap ratings when you're physically at a location
- **Saved places** — bookmark spots that work for you
- **Location details** — selecting any place shows its short address, open/closed status (via Google Places), and current weather (via Open-Meteo); a 🚧 construction chip appears when the Ontario 511 API reports active roadwork within ~2km (proxied through the backend to avoid CORS)
- **Live traffic layer** — toggleable real-time road congestion overlay (green → red) powered by Mapbox Traffic v1; no extra API key required
- **Category filters** — filter the map by venue type: cafes, parks, libraries, restaurants, fitness; sensory filters (quiet, low crowds, soft lighting) also available
- **Search sidebar** — search results populate the sidebar list; smart plural/singular matching so "cafe" and "cafes" return the same results
- **Onboarding survey** — first-time users see a 3-step card-tap flow to set their noise, lighting, and crowd preferences before exploring
- **No account needed to explore** — sign up only to review or save

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Mapbox GL JS, react-map-gl |
| Backend | Node.js, Express 5 |
| Database | PostgreSQL via Supabase, Prisma ORM |
| Auth | Auth0 |
| AI | Google Gemini 2.5-flash |
| Enrichment | node-cron + Yelp + Foursquare + Google Places + City of Toronto → Gemini |
| Images | Cloudinary |
| Security | helmet, express-rate-limit, CORS |

---

## Running locally

### 1. Clone and install

```bash
git clone https://github.com/Rohan-08-12/SenseMap.git
cd SenseMap/AutisticAI
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 2. Set up environment variables

Copy the example files and fill in your keys:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**Backend** (`backend/.env`) requires: `DATABASE_URL`, `AUTH0_AUDIENCE`, `AUTH0_ISSUER_BASE_URL`, `GEMINI_API_KEY`, `GOOGLE_PLACES_KEY`, `CLOUDINARY_*`, `YELP_API_KEY`, `FOURSQUARE_API_KEY`, `N8N_WEBHOOK_SECRET`. Optional: `ALLOWED_ORIGINS`, `RESEND_API_KEY`, `RESEND_FROM`, `ADMIN_NOTIFY_EMAIL`, `API_BASE_URL`, `ENRICHMENT_MAX_PER_RUN`, `ENRICHMENT_DELAY_MS`, `ENRICHMENT_CATCHUP` (see `backend/.env.example`)

**Frontend** (`frontend/.env`) requires: `VITE_MAPBOX_TOKEN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_AUDIENCE`, `VITE_API_URL` (and `VITE_POSTHOG_KEY` for analytics)

Never commit `.env` files or paste key values into issues or pull requests.

### 3. Run

```bash
# From AutisticAI/
npm run dev:servers       # Frontend + backend together
npm run dev:all           # OSM seed import, then both servers
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

### 4. Seed the database

```bash
# From AutisticAI/backend/

# Option A — 15 handpicked Toronto showcase locations with human-written reviews
node seed_demo.js

# Option B — bulk seed via Google Places (requires backend running)
# Fires 35 Toronto search queries through /discover, which stores at most 3 new places per search, without scores
node seed_bulk.js

# Option C — OpenStreetMap import (Toronto locations; stores placeholder category defaults, not data)
npm run osm-import
```

`seed_bulk.js` needs a valid `GOOGLE_PLACES_KEY`. Places from options B and C have no trustworthy scores until visitors review them or the nightly enrichment estimates them, so they show "Not enough data yet". Only run these scripts against a local database.

---

## Project structure

```
AutisticAI/
├── frontend/
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── services/api.js # Axios instance + all API calls
│   │   └── theme/          # ThemeContext, CSS variables
│   └── public/
├── backend/
│   ├── src/
│   │   ├── routes/         # Express route handlers
│   │   ├── middleware/      # Auth, syncUser, optionalAuth, n8nAuth
│   │   └── lib/            # Prisma, Gemini, scores, systemBot, enrichmentCron
│   ├── scripts/            # Maintenance scripts (dry-run by default; local DB only unless --allow-remote-db)
│   ├── prisma/
│   │   └── schema.prisma
│   ├── seed_demo.js        # 15 showcase locations with human reviews
│   └── seed_bulk.js        # Bulk seeder via Google Places + Gemini pipeline
└── DOCS.md                 # Full technical documentation
```

---

## Enrichment schedule and health

- **Nightly run:** `0 4 * * *` America/Toronto, capped by `ENRICHMENT_MAX_PER_RUN` (default 50, clamped 1–1000).
- **Missed-run check:** hourly at :37. If no `EnrichmentRun` started in the last 26h and none is running, it starts a `catchup` run. It follows the same rule as the boot catch-up: on only when `RAILWAY_ENVIRONMENT` is set or `ENRICHMENT_CATCHUP=true`; always off when `ENRICHMENT_CATCHUP=false` or `NODE_ENV=test`. Leave it unset locally so a dev server never starts paid runs.
- **Health:** `GET /enrichment/freshness` reports `hoursSinceLastUpdate` (last run that finished `success` with `updated > 0`). `healthy` means that is within 36h. The hourly watchdog emails `ADMIN_NOTIFY_EMAIL` at most once per 24h when it is not (the last-alert time is stored in the database, so restarts do not repeat it).
- **Skip reasons:** each run records why places were skipped (and Google Places denials) in `EnrichmentRun.errors`; `lastRun` in `/enrichment/freshness` shows them.
- The legacy n8n workflow writes no `EnrichmentRun` rows, so it does not count toward these checks.

---

## Deploying for beta

| Service | What to deploy |
|---|---|
| [Railway](https://railway.app) | Backend (`AutisticAI/backend`) and frontend (`AutisticAI/frontend`); both auto-deploy on push to `main` |

Live at **[sensemap.app](https://sensemap.app)**. Production deploys, database changes and secrets are handled by the maintainer, not by contributors.

Set `ALLOWED_ORIGINS` on Railway to `https://sensemap.app`. Add `https://sensemap.app` to Auth0's Allowed Callback URLs, Logout URLs, and Web Origins.

---

## Tests

From `backend/`:

```bash
npm test          # unit tests, no database
npm run test:db   # integration tests: needs a THROWAWAY local Postgres (DATABASE_URL on localhost / 127.0.0.1); they delete rows
```

Never point `DATABASE_URL` at a database you want to keep when running `test:db`.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contribution guide.

The `main` branch is protected — all changes go through a pull request:

```bash
git checkout -b fix/your-change
# make changes
git push origin fix/your-change
gh pr create --fill
```

---

## Documentation

See [DOCS.md](./DOCS.md) for full API reference, data models, architecture, and data flow diagrams.

---

## Monitoring

| Tool | Purpose |
|---|---|
| [UptimeRobot](https://uptimerobot.com) | Pings sensemap.app every 5 min; emails on downtime |
| [Sentry](https://sentry.io) | Frontend JS error tracking via Loader Script in `frontend/index.html` |
| [PostHog](https://posthog.com) | Product analytics, session replay, web vitals (`VITE_POSTHOG_KEY`) |

---

## Auth Notes

- Auth0 domain: `dev-nx7sf078z0lxwgez.us.auth0.com`
- Google OAuth uses production keys (not Auth0 dev keys) — configured in Auth0 → Authentication → Social → Google
- Google Cloud OAuth redirect URI: `https://dev-nx7sf078z0lxwgez.us.auth0.com/login/callback`
- **Email OTP login** — passwordless sign-in via Auth0 email connection; enabled in Auth0 → Authentication → Passwordless → Email; promoted to domain level so all apps can use it
- In in-app browsers (LinkedIn, Instagram, Twitter), Google sign-in is hidden and only email OTP is shown — detected via `isInAppBrowser` in `frontend/src/utils.js`
- Login modal (`LoginModal.jsx`) gates all sign-in entry points — replaces direct `loginWithRedirect()` calls throughout the app

---

## Status

**Beta** — Toronto only. Active development.

---

## Known Issues / To-do

| # | Issue | Notes |
|---|---|---|
| 1 | **Construction chip unreliable** | The 🚧 chip is proxied through the backend to the Ontario 511 API. The 511 API is slow (~3–8s), covers only highway/major-arterial roadwork (not local street construction), and its data coverage outside the GTA is sparse. The chip works when the 511 API responds in time but is not guaranteed. Fix: add a dedicated municipal construction data source or cache the 511 response more aggressively on a cron schedule. |
