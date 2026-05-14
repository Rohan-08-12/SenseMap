# SenseMap

**Find places that feel right for you.**

SenseMap is a community-powered sensory map helping autistic and sensory-sensitive individuals discover comfortable public spaces. Every location shows real community ratings for noise, lighting, and crowd density — plus AI-generated insights from Google Gemini.

Currently in beta, covering **Toronto**.

---

## What it does

- **Interactive map** — color-coded pins and heatmap showing sensory comfort at a glance
- **Sensory scores** — noise, lighting, crowds, and overall comfort rated 1–10 by real users
- **AI insights** — Gemini 2.5-flash analyzes community reviews and surfaces noise patterns, best visit times, and sensory tags
- **Personalized matching** — set your own noise/lighting/crowd tolerance and get a % match for every location
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

### 4. Seed the database (Toronto)

```bash
npm run osm-import
```

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
│   └── prisma/
│       └── schema.prisma
└── DOCS.md                 # Full technical documentation
```

---

## Documentation

See [DOCS.md](./DOCS.md) for full API reference, data models, architecture, and data flow diagrams.

---

## Status

**Beta** — Toronto only. Active development.
