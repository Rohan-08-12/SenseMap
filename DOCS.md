# SenseMap — Platform Documentation

> Last updated: May 19, 2026

---

## What is SenseMap?

SenseMap helps autistic and sensory-sensitive individuals find comfortable public spaces. Users explore an interactive map, view community sensory ratings (noise, lighting, crowd), submit reviews, check in to locations, and receive AI-powered insights tailored to their personal sensory profile.

---

## Monorepo Structure

```
AutisticAI/
├── frontend/          # React 19 + Vite (port 5173)
├── backend/           # Express 5 + Prisma + PostgreSQL (port 3000)
├── package.json       # Root scripts (runs both servers)
└── DOCS.md            # This file
```

---

## Running the App

From the `AutisticAI/` root:

```bash
npm run dev:servers    # Start frontend + backend together
npm run dev:all        # OSM import first, then both servers
npm run osm-import     # Seed DB from OpenStreetMap (~3800 Toronto locations, default scores)
```

Seed the database (run from `AutisticAI/backend/`):

```bash
node seed_demo.js      # 15 handpicked Toronto locations with human-written reviews
node seed_bulk.js      # Bulk seed via Google Places + Gemini (requires servers running)
```

Run all three seeders for the fullest map. `seed_demo.js` and `seed_bulk.js` require a valid `GOOGLE_PLACES_KEY` with Places API enabled.

Frontend only:
```bash
cd frontend && npm run dev
```

Backend only:
```bash
cd backend && npm run dev
```

---

## Environment Variables

### Frontend (`frontend/.env`)
| Variable | Purpose |
|---|---|
| `VITE_MAPBOX_TOKEN` | Mapbox GL map tiles |
| `VITE_AUTH0_CLIENT_ID` | Auth0 app client ID |
| `VITE_AUTH0_DOMAIN` | Auth0 tenant domain |
| `VITE_AUTH0_AUDIENCE` | Auth0 API audience |
| `VITE_API_URL` | Backend base URL (http://localhost:3000) |

### Backend (`backend/.env`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `GOOGLE_PLACES_KEY` | Google Places API key |
| `AUTH0_AUDIENCE` | JWT audience validation |
| `AUTH0_ISSUER_BASE_URL` | JWT issuer validation |
| `GEMINI_API_KEY` | Google Generative AI (Gemini 2.5-flash) |
| `CLOUDINARY_CLOUD_NAME` | Image hosting |
| `CLOUDINARY_API_KEY` | Image hosting |
| `CLOUDINARY_API_SECRET` | Image hosting |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins (defaults to localhost) |
| `PORT` | Server port (default 3000) |

---

## Security

All production deployments must set `ALLOWED_ORIGINS` to the frontend domain.

| Layer | Implementation |
|---|---|
| HTTP headers | `helmet` on all routes |
| CORS | Restricted to `ALLOWED_ORIGINS` env var |
| Body size | `express.json({ limit: "1mb" })` |
| Rate limiting | API: 200/15min · Reviews: 20/hr · AI: 30/min |
| Auth | Auth0 JWT validation on all write endpoints |
| Input validation | Length + type checks on reviews, AI, upload, discover routes |
| Error responses | Global error handler — never returns stack traces |
| File uploads | Images only, 5MB max (Multer) |

---

## Database Models (Prisma + Supabase)

### User
| Field | Type | Notes |
|---|---|---|
| id | String | UUID, primary key |
| auth0Id | String | Unique, from Auth0 |
| email | String | Unique |
| username | String? | Optional display name |
| createdAt | DateTime | |
| updatedAt | DateTime | |

Relations: savedPlaces, reviews, checkIns, sensoryProfile

---

### Location
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| googlePlaceId | String | Unique, from Google Places |
| name | String | |
| description | String? | |
| category | String | library, cafe, park, museum, etc. |
| address | String? | |
| imageUrl | String? | Cloudinary URL |
| latitude | Float | |
| longitude | Float | |

Relations: reviews, checkIns, sensoryScores, savedBy
Indexes: `category`

---

### Review
| Field | Type | Notes |
|---|---|---|
| id | String | UUID |
| userId | String | FK → User |
| locationId | String | FK → Location |
| bodyText | String | Written review |
| rating | Int | 1–10 overall comfort |
| noiseLevel | Int | 1–10 (1 = quiet) |
| lightingLevel | Int | 1–10 (1 = dim) |
| crowdLevel | Int | 1–10 (1 = empty) |
| visitedAt | DateTime | |
| visitTime | String? | morning, afternoon, evening |
| imageUrl | String? | Optional photo |
| aiNoiseScore | Float? | Gemini extracted |
| aiLightingScore | Float? | Gemini extracted |
| aiCrowdScore | Float? | Gemini extracted |
| aiSentiment | String? | positive / neutral / negative |
| aiTags | String[] | e.g. ["quiet", "good lighting"] |

Indexes: `locationId`, `userId`

---

### SensoryScore
Aggregated per location. Updated on every new review via `recalculateScores()`.

| Field | Type | Notes |
|---|---|---|
| locationId | String | Unique FK → Location |
| noiseScore | Float | Average noise (1–10) |
| lightingScore | Float | Average lighting (1–10) |
| crowdScore | Float | Average crowd (1–10) |
| comfortScore | Float | Average rating (1–10) |
| reviewCount | Int | Total reviews |

Indexes: `locationId`, `userId`

---

### SensoryProfile
Per-user tolerance settings for personalisation.

| Field | Type | Notes |
|---|---|---|
| userId | String | Unique FK → User |
| noiseTolerance | Int | 1–5 (how much noise is OK) |
| lightingTolerance | Int | 1–5 |
| crowdTolerance | Int | 1–5 |
| notes | String? | Free text |

---

### SavedPlace
Bookmarked locations. Unique constraint on `[userId, locationId]`.

### CheckIn
Visit tracking. 1-hour cooldown enforced per user+location on the backend.

---

## Backend Architecture

### Request Lifecycle

```
Request
  └── app.js (helmet, CORS, rate limiting, body limit)
       └── middleware/auth.js        → validate Auth0 JWT
            └── middleware/syncUser.js → upsert User in DB
                 └── route handler
                      └── lib/scores.js (recalculate on review create)
                           └── global error handler (clean JSON, no stack traces)
```

### Middleware

| File | Export | Purpose |
|---|---|---|
| `middleware/auth.js` | `requireAuth` | Validates Auth0 Bearer token, attaches `req.auth` |
| `middleware/optionalAuth.js` | `optionalAuth` | Like requireAuth but never blocks (public routes) |
| `middleware/syncUser.js` | `syncUser` | Auto-creates/updates User in Prisma after auth |

---

## API Endpoints

### Locations (`/locations`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/locations` | No | All locations as GeoJSON |
| GET | `/locations/heatmap` | No | Top 500 scored locations (filters default scores) |
| GET | `/locations/match` | Required | Personalized matches sorted by match score |
| GET | `/locations/search?q=` | No | Search by name/category/address; auto-normalizes plural/singular (e.g. "cafes" matches "cafe" records) |
| GET | `/locations/:id/hours` | No | Opening hours from Google Places API using stored `googlePlaceId`; returns `{ available, open_now, weekday_text }` |
| GET | `/locations/:id` | No | Single location + last 10 reviews (includes `user.username` and `user.email` for each review) |

### Reviews (`/reviews`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/reviews/:locationId` | No | All reviews for a location |
| POST | `/reviews` | Required | Submit review (validated); triggers score recalculation |

### AI (`/ai`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/ai/analyze` | Required | Extract sensory scores from review text (Gemini) |
| POST | `/ai/insights/:locationId` | Required | Full AI summary of a location's sensory profile |

### Rankings (`/rankings`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/rankings` | No | All locations sorted by comfortScore (desc) |

### Discovery (`/discover`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/discover?q=&lat=&lng=` | No | DB + Google Places hybrid search; caches new results |

### Profiles (`/profiles`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/profiles/me` | Required | Get user's sensory profile |
| PUT | `/profiles/me` | Required | Create/update sensory profile |

### Saved Places (`/saved-places`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/saved-places` | Required | User's saved locations |
| POST | `/saved-places` | Required | Save a location |
| DELETE | `/saved-places/:locationId` | Required | Remove a saved location |

### Check-ins (`/checkins`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/checkins/:locationId` | Required | Check in (1-hour cooldown per location) |
| GET | `/checkins/recent` | Required | Last 10 user check-ins |

### Upload (`/upload`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/upload` | Required | Upload image to Cloudinary (5MB limit, images only); returns `{ imageUrl }` |

### Users (`/users`)

| Method | Path | Auth | Description |
|---|---|---|---|
| DELETE | `/users/me` | Required | Delete user account and all associated data |

---

## Library Files (`backend/src/lib/`)

### `prisma.js`
Singleton Prisma client using `@prisma/adapter-pg` (pg driver for Supabase).

### `gemini.js`
Initializes `@google/generative-ai` with `gemini-2.5-flash`. Exports `model` and `embeddingModel`.

### `scores.js` — `recalculateScores(locationId)`
- Fetches all reviews for a location
- Computes **time-decay weighted averages** for noise, lighting, crowd, and rating
- Decay formula: `weight = e^(-λ * ageDays)` where λ = `ln(2) / 180` (half-life of 180 days)
- A review from 6 months ago counts at 50%, 12 months = 25%, 2 years = 6.25%
- Old reviews never fully disappear — fresh visits progressively dominate
- Divides slider values (1-10) by 2 before storing (1-5 scale)
- Upserts the `SensoryScore` record
- **Must be called after every review create/update**

### `systemBot.js` — `getSystemUser()`
Shared credentials for the SenseMap Bot account used to seed AI-generated reviews from Google Places. Upserts the bot user on first call.

```js
export const SYSTEM_BOT = {
  auth0Id: "system|sensemap-bot",
  email: "bot@sensemap.app",
  username: "SenseMap Bot",
};
```

Bot-seeded reviews are labeled "AI-assisted" in the UI.

### `placesService.js`
Handles all Google Places integration + AI enrichment:

| Function | Purpose |
|---|---|
| `classifyCategory(types)` | Maps Google Place types → app categories |
| `searchGooglePlaces(query, lat, lng)` | Google Places Text Search |
| `getGooglePlaceDetails(placeId)` | Full place details inc. photos + reviews |
| `uploadPlacePhoto(photoReference)` | Uploads Google photo → Cloudinary |
| `analyzeWithGemini(name, category, reviews)` | Gemini analysis of reviews → sensory scores + seed reviews |
| `discoverAndCachePlace(googlePlace)` | Full enrichment pipeline (create location + photo + AI reviews) |

### `cloudinary.js`
Initializes Cloudinary SDK with API credentials.

### `geojson.js` — `toGeoJSON(locations)`
Converts Location array to GeoJSON FeatureCollection with sensory scores as properties.

---

## Frontend Architecture

### Entry Points

**`main.jsx`**
- Wraps app in `Auth0Provider`, `ThemeProvider`, `BrowserRouter`
- Renders `App.jsx`

**`App.jsx`**
- Controls top-level navigation: `LaunchScreen` → `NonLoginMapView` → `LoggedInMapView`
- Manages `showMap` state and `exploreParams` (initial search query + filter)
- Sets Auth0 token getter on the Axios interceptor

### `services/api.js`
Single Axios instance for all API calls:
- Base URL from `VITE_API_URL`
- Default timeout: 10s (heatmap: 60s, rankings: 30s)
- Request interceptor: attaches Auth0 JWT (skips public routes)

All exported functions:
```
getLocations()           getLocationById(id)
getLocationHeatmap()     getLocationMatch()
searchLocations(q)       discoverLocations(q, lat, lng)
submitReview(data)       getReviewsByLocation(id)
getRankings()
getSensoryProfile()      updateSensoryProfile(data)
getAIInsights(id)        analyzeReview(text)
getSavedPlaces()         savePlace(id)        removeSavedPlace(id)
uploadImage(formData)
checkIn(locationId)
getRecentCheckIns()
deleteAccount()
```

---

## Frontend Components

### `LaunchScreen.jsx`
Landing page. Hero text, category cards, search bar, auth buttons, theme switcher, legal footer.
- Category cards and popular tags use valid MapView filter keys (`quiet-now`, `soft-lighting`, `low-crowds`, `outdoor`, `before-noon`)

### `NonLoginMapView.jsx`
Full public map experience (no login required).
- Fetches heatmap + rankings on mount
- Sidebar: quick filters, top ranked places, search
- Location detail panel: snapshot stats, sign-in prompt for write actions

### `LoggedInMapView.jsx`
Authenticated map with all features.
- Nav tabs: Explore, Dashboard, Saved Places, Sensory Profile, Settings
- Fetches: match scores, AI insights, saved places, user profile
- Check-in flow: 1-hour cooldown → quick rating prompt after check-in
- AI-generated data labeled with purple "AI" / "Gemini AI" badges throughout
- **Data source label** on sensory scores — shows one of four states:
  - Green: community reviews only (real visitor data)
  - Purple: AI-estimated only (Gemini-seeded, no community visits yet)
  - Grey: mixed community + AI-seeded
  - Yellow: no reviews yet (default estimates)
- **Review list** — last 5 reviews with author, date, noise/lighting/crowd sliders, body text; SenseMap Bot reviews labeled with purple AI badge

### `MapView.jsx`
Pure Mapbox GL map component using native `react-map-gl` layers.
- `circle` layer — location pins, color-interpolated by comfort score (red → yellow → green)
- `heatmap` layer — sensory overlay (toggleable)
- `mapRef.flyTo()` — imperative navigation for user geolocation and location selection
- Props: `onLocationSelect`, `filter`, `searchResultsGeoJSON`, `heatmapEnabled`, `heatmapData`, `flyToLocation`, `userCoords`, `mapStyle`

> **Note:** deck.gl has been removed. All map layers use native Mapbox GL via react-map-gl `Source` + `Layer` to fix coordinate drift at low zoom with pitch.

### `SubmitReview.jsx`
Review form:
1. Rating + sliders (noise/lighting/crowd 1–10)
2. Text body + photo upload (Cloudinary)
3. Visit time selector
4. AI auto-fill button — sends text to Gemini, fills sliders automatically

### `SensoryProfile.jsx`
6 sliders: Noise, Lighting, Crowd (saved to backend, 1–5), + Olfactory, Spatial Openness, Acoustic Echo (UI only).
Auto-saves after 600ms debounce.

### `Dashboard.jsx`
Welcome view with: env stats, best nearby match, profile preview, saved places list, search.

### `SavedPlaces.jsx`
Grid of bookmarked locations. Sort by: match score, distance, noise, crowd, name.

### `Settings.jsx`
Account info, accessibility options (font size, high contrast, reduced motion), theme switcher, legal links, account deletion.

### `LegalModal.jsx`
Bottom-sheet modal (mobile) / centered modal (desktop) containing Privacy Policy and Terms of Use. Linked from LaunchScreen footer and Settings.

### `ErrorBoundary.jsx`
React class component — catches render errors and shows a graceful fallback with a refresh button.

---

## Key Data Flows

### 1. Location Discovery
```
User searches
  → GET /discover?q=&lat=&lng=
  → DB search + Google Places (parallel, 12s timeout)
  → New Google results quick-cached as Location
  → Background: photo → Cloudinary, reviews → Gemini → seed reviews (SenseMap Bot)
  → Returns combined GeoJSON
```

### 2. Review Submission
```
User fills form
  → (Optional) AI auto-fill: POST /ai/analyze → Gemini → scores fill sliders
  → Photo: POST /upload → Cloudinary → imageUrl
  → POST /reviews (validated: rating 1-10, body ≤ 2000 chars)
  → recalculateScores() re-aggregates SensoryScore
```

### 3. Check-in Flow
```
User taps "I'm here"
  → POST /checkins/:locationId
  → Backend: 1-hour cooldown check (429 + minutesLeft if on cooldown)
  → Success: quick low/high rating prompt for noise, lighting, crowds
```

### 4. Personalised Matching
```
User sets sensory profile (noise/lighting/crowd tolerance 1–5)
  → GET /locations/match
  → Backend compares location scores vs user tolerances (both 1–5 scale)
  → Null scores default to 3 (neutral) via safeScore()
  → Match % = max(0, 100 - |score - tolerance| * 25), clamped to [0, 100]
  → Returns sorted by match score
```

### 5. AI Insights
```
Frontend: POST /ai/insights/:locationId
  → Backend fetches all reviews for location
  → Filters out blank bodyText
  → Gemini 2.5-flash analyzes text
  → Returns: noise summary, lighting summary, best time, tags, confidence %
  → Frontend displays with "Gemini AI" badge
```

---

## Heatmap Data

`GET /locations/heatmap` returns the top 500 locations by review count, filtering out locations with default seeded scores (2.8 or 3.8) to surface only locations with meaningful community or Gemini-analyzed data. Scores are clamped to 1–5 for the map layer.

---

## Sensory Score Scale

All scores stored and displayed on a **1–5 scale** (review sliders are 1–10 and divided by 2 before storage in `recalculateScores()`).

| Score | Meaning |
|---|---|
| 1.0–2.0 | Low stimulation (quiet, dim, empty) |
| 2.5–3.5 | Moderate |
| 4.0–5.0 | High stimulation (loud, bright, busy) |

**Lower score = more sensory-friendly.**

---

## Themes

Two visual themes stored in `localStorage`:

| Theme | Colors |
|---|---|
| `nature` | Green + beige tones |
| `calm` | Blue + teal tones |

Applied via `data-theme` attribute on `<html>` + CSS variables.

---

## UX Design Principles

- **Soft colors, minimal animation** — no jarring transitions
- **Generous spacing** — avoid dense layouts
- **`useReducedMotion`** — respects OS-level accessibility settings
- **Graceful degradation** — fallback data if APIs timeout
- **Debounced saves** — sliders auto-save after 600ms, no save button needed
- **Optional auth** — public routes work without login; protected features prompt sign-in
- **AI transparency** — all AI-generated content labeled with purple "Gemini AI" badges; individual reviews show author + AI badge for SenseMap Bot; sensory score source labeled per location (community / AI-estimated / mixed)

---

## Seeding Scripts (run from `backend/`)

```bash
node seed_demo.js      # 15 handpicked Toronto locations with human-written reviews
node seed_bulk.js      # Bulk seed via /discover → Google Places + Gemini pipeline (requires backend running)
npm run osm-import     # ~3800 Toronto locations from OpenStreetMap (default scores only)
```

`seed_demo.js` and `seed_bulk.js` require a valid `GOOGLE_PLACES_KEY` with the Places API enabled.
`seed_bulk.js` fires 35 plain place-type queries (e.g. "cafe Annex Toronto") — descriptive words like "quiet" or "calm" are not supported by Google Places and return 0 results.

## Debug / Test Scripts (run from `backend/`)

```bash
node test_db.js        # Test Prisma DB connection
node test_pg.js        # Test raw PostgreSQL connection
node verify_data.js    # Verify data integrity
node test_api.js       # Test API endpoints
node debug_places.js   # Debug Google Places enrichment
```

---

## Known Issues / TODOs

- Currently Toronto-only — city expansion planned post-beta
