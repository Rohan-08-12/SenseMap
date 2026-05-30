# SenseMap Enrichment Pipeline

## What it does

Every location on SenseMap has sensory scores (noise, lighting, crowd) from day one — even with zero community reviews. The enrichment pipeline is what makes this possible.

It pulls reviews from Yelp, Foursquare, and Reddit, feeds them into Gemini 2.5-flash, and stores the extracted sensory scores against each location. Community reviews then layer on top and progressively become the primary source as real visits accumulate.

**Before enrichment:** most locations showed no data — scores only existed if a real user had submitted a review.

**After enrichment:** every location has an AI-estimated sensory baseline. The map is useful from day one.

---

## What is "stale"?

A location is **stale** if it needs re-enriching:

| State | Meaning |
|---|---|
| `lastEnrichedAt = null` | Never enriched — always stale |
| `lastEnrichedAt` < 7 days ago | Fresh — skip |
| `lastEnrichedAt` > 7 days ago | Stale — re-enrich |

Think of it like milk. Fresh milk is fine. Milk from 2 weeks ago needs replacing. Stale just means the scores are old enough that new reviews on Yelp or Foursquare might have changed the picture.

---

## How the pipeline works

```
Trigger (4am cron or manual POST /enrichment/trigger)
  │
  ▼
Find all stale locations (lastEnrichedAt null or > 7 days old)
  │
  ▼
For each location (1.5s gap between calls):
  │
  ├── Fetch Yelp reviews by name + coordinates
  ├── Fetch Foursquare tips by name + coordinates
  └── Fetch Reddit posts mentioning the location
          │
          ▼
      Combined review text → Gemini 2.5-flash
          │
          ▼
      noise_score, lighting_score, crowd_score (1–10)
          │
          ▼
      Convert to 1–5 scale
          │
          ├── Scores changed by > 0.5 → update DB + log to EnrichmentLog
          └── Scores unchanged → just update lastEnrichedAt (mark fresh)
  │
  ▼
[Enrichment] Done — updated: X, skipped: Y, failed: Z
```

---

## Schedule

The cron job runs **every day at 4am Toronto time** — but it only does meaningful work once a week, when locations cross the 7-day stale threshold.

### First run (one-time seed)
All locations are stale (never enriched). Every location gets processed. After this run, the entire map has data.

### Nightly runs (days 1–6 after seed)
Almost nothing is stale yet. The cron fires, finds 0 (or very few) stale locations, and finishes in seconds. No cost, no impact.

### Weekly re-enrichment (day 7+)
All locations cross the 7-day threshold and become stale again. The cron re-enriches all of them with the latest reviews. Scores update if anything has meaningfully changed.

### Timeline example

```
Day 0  (now)    Manual trigger → all 500 locations enriched
Day 1   4am     0 stale → done in seconds
Day 2   4am     0 stale → done in seconds
Day 3   4am     0 stale → done in seconds
Day 4   4am     0 stale → done in seconds
Day 5   4am     0 stale → done in seconds
Day 6   4am     0 stale → done in seconds
Day 7   4am     500 stale → all re-enriched (~12 min)
Day 14  4am     500 stale → all re-enriched (~12 min)
...and so on
```

New locations added to the DB are automatically picked up on the next 4am run — no manual steps needed.

---

## Data sources

| Source | What it provides | Fallback |
|---|---|---|
| Yelp | Business metadata + up to 10 recent reviews | Business info only if reviews endpoint is blocked |
| Foursquare | Up to 5 tips from locals | Skipped if no results |
| Reddit | Posts mentioning the location + "noise OR crowd OR lighting" | Skipped if no relevant posts |

If all three sources return nothing, the location is still marked as enriched (with `dataSource: "category"`) so it doesn't get retried every day.

---

## Score blending

After enrichment, a location's displayed scores blend community reviews and AI-estimated scores based on how much real data exists:

| Community reviews | Data source label | How scores are calculated |
|---|---|---|
| 5 or more | `community` | 100% community reviews |
| 1–4 reviews | `community` | 70% community + 30% AI-estimated |
| 0 reviews | `estimated` | 100% AI-estimated (Yelp/Foursquare/Reddit) |
| No data at all | `category` | Default scores |

As a location gets more community reviews, the AI-estimated scores fade out automatically.

---

## Manual trigger

To run enrichment immediately (useful after adding new locations or after a failed run):

```bash
curl -X POST https://sensemap-production.up.railway.app/enrichment/trigger \
  -H "x-n8n-secret: YOUR_SECRET"
```

Responds instantly. Enrichment runs in the background on the Railway server.

---

## Checking progress

```bash
curl https://sensemap-production.up.railway.app/enrichment/stale \
  -H "x-n8n-secret: YOUR_SECRET" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Still stale:', d['count'])"
```

When this returns `Still stale: 0`, every location has up-to-date scores.

---

## Monitoring

| Where | What to look for |
|---|---|
| Railway deploy logs | `[Enrichment] Starting — N locations` and `[Enrichment] Done — updated: X, skipped: Y, failed: Z` |
| Prisma Studio → `EnrichmentLog` | Full history of every score update |
| Prisma Studio → `Location.lastEnrichedAt` | When each location was last processed |
| Prisma Studio → `Location.dataSource` | `"yelp"`, `"foursquare"`, `"reddit"` or combinations |

---

## Key files

| File | Purpose |
|---|---|
| `backend/src/lib/enrichmentCron.js` | Core logic — fetch, analyze, save, schedule |
| `backend/src/routes/enrichment.js` | API endpoints (`/stale`, `/location`, `/trigger`) |
| `backend/src/middleware/n8nAuth.js` | Protects enrichment endpoints with `x-n8n-secret` header |
| `backend/scripts/trim_locations.js` | One-time utility to trim DB to a target location count |

---

## Environment variables required

```
YELP_API_KEY=<yelp-fusion-api-key>
FOURSQUARE_API_KEY=<foursquare-api-key>
GEMINI_API_KEY=<google-gemini-key>        # must be paid tier (1000 RPM)
N8N_WEBHOOK_SECRET=<secret>               # protects /enrichment/* endpoints
```
