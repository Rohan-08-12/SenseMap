# SenseMap

**Find places that feel right for you.**

SenseMap is a community-powered sensory map helping autistic and sensory-sensitive individuals discover comfortable public spaces. Every location shows real community ratings for noise, lighting, and crowd density — plus AI-generated insights from Google Gemini.

Currently in beta, covering **Toronto**.

---

## What it does

- **Interactive map** — color-coded pins and heatmap showing sensory comfort at a glance
- **Sensory scores** — noise, lighting, crowds, and overall comfort on a 1–5 scale; aggregated with exponential time-decay (6-month half-life) so fresh visits progressively outweigh older data
- **Data transparency** — every location clearly labels whether scores come from community reviews, AI-seeded data, or a mix of both
- **AI insights** — Gemini 2.5-flash analyzes community reviews and surfaces noise patterns, best visit times, and sensory tags
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

**Backend** (`backend/.env`) requires: `DATABASE_URL`, `AUTH0_AUDIENCE`, `AUTH0_ISSUER_BASE_URL`, `GEMINI_API_KEY`, `GOOGLE_PLACES_KEY`, `CLOUDINARY_*`

**Frontend** (`frontend/.env`) requires: `VITE_MAPBOX_TOKEN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_AUDIENCE`, `VITE_API_URL`

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

# Option B — bulk seed via Google Places + Gemini (requires backend running)
# Fires 35 Toronto search queries through the /discover pipeline
node seed_bulk.js

# Option C — OpenStreetMap import (~3800 Toronto locations, default scores)
npm run osm-import
```

Run all three for the fullest map. `seed_demo.js` and `seed_bulk.js` require a valid `GOOGLE_PLACES_KEY`.

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
│   │   ├── middleware/      # Auth, syncUser, optionalAuth
│   │   └── lib/            # Prisma, Gemini, scores, systemBot
│   ├── prisma/
│   │   └── schema.prisma
│   ├── seed_demo.js        # 15 showcase locations with human reviews
│   └── seed_bulk.js        # Bulk seeder via Google Places + Gemini pipeline
└── DOCS.md                 # Full technical documentation
```

---

## Deploying for beta

| Service | What to deploy |
|---|---|
| [Railway](https://railway.app) | Backend (`AutisticAI/backend`) |
| [Vercel](https://vercel.com) | Frontend (`AutisticAI/frontend`) |

Live at **[sensemap.app](https://sensemap.app)**.

Set `ALLOWED_ORIGINS` on Railway to `https://sensemap.app`. Add `https://sensemap.app` to Auth0's Allowed Callback URLs, Logout URLs, and Web Origins.

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
- In-app browser warning shown automatically when users open the app via LinkedIn, Instagram, or Twitter — prompts them to open in Safari/Chrome for Google sign-in

---

## Status

**Beta** — Toronto only. Active development.

---

## Known Issues / To-do

| # | Issue | Notes |
|---|---|---|
| 1 | **Construction chip unreliable** | The 🚧 chip is proxied through the backend to the Ontario 511 API. The 511 API is slow (~3–8s), covers only highway/major-arterial roadwork (not local street construction), and its data coverage outside the GTA is sparse. The chip works when the 511 API responds in time but is not guaranteed. Fix: add a dedicated municipal construction data source or cache the 511 response more aggressively on a cron schedule. |
