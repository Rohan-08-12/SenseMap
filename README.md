# SenseMap

**Find places that feel right for you.**

SenseMap is a community-powered sensory map helping autistic and sensory-sensitive individuals discover comfortable public spaces. Every location shows real community ratings for noise, lighting, and crowd density — plus AI-generated insights from Google Gemini.

Currently in beta, covering **Toronto**.

---

## What it does

- **Interactive map** — color-coded pins and heatmap showing sensory comfort at a glance
- **Sensory scores** — noise, lighting, crowds, and overall comfort on a 1–5 scale
- **Data transparency** — every location clearly labels whether scores come from community reviews, AI-seeded data, or a mix of both
- **AI insights** — Gemini 2.5-flash analyzes community reviews and surfaces noise patterns, best visit times, and sensory tags
- **Personalized matching** — set your own noise/lighting/crowd tolerance and get a % match for every location
- **Review list** — see individual reviews with author, date, and slider ratings; AI-seeded reviews labeled with a badge
- **Check-in flow** — quick tap ratings when you're physically at a location
- **Saved places** — bookmark spots that work for you
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

Set `ALLOWED_ORIGINS` on Railway to your Vercel URL. Add your Vercel URL to Auth0's Allowed Callback URLs, Logout URLs, and Web Origins.

---

## Documentation

See [DOCS.md](./DOCS.md) for full API reference, data models, architecture, and data flow diagrams.

---

## Status

**Beta** — Toronto only. Active development.
