# SenseMap Enrichment Pipeline

> **n8n has been removed.** The pipeline now runs as a built-in `node-cron` job inside the Express backend — no external services, webhooks, or cloud accounts needed.
>
> The workflow JSON in this folder (`sensemap-enrichment-workflow.json`) is kept for reference only.

---

## How it works now

The enrichment pipeline lives in `backend/src/lib/enrichmentCron.js` and starts automatically when the backend boots.

```
Server starts
  → startEnrichmentCron() registers a daily cron at 4am Toronto
  → Every night at 4am (or on manual trigger):
      Find all locations where lastEnrichedAt is null or older than 7 days
      For each location (1.5s gap between calls):
        1. Fetch reviews from Yelp + Foursquare + Reddit (parallel)
        2. Send combined text to Gemini 2.5-flash → noise/lighting/crowd scores
        3. Save scores to DB if they differ by > 0.5 or location was never enriched
        4. Write to EnrichmentLog
      Log: [Enrichment] Done — updated: X, skipped: Y, failed: Z
```

**Before this pipeline:** locations only had scores if real users submitted reviews — most locations showed no data at all.

**After:** every location has an AI-estimated sensory baseline from day one. Community reviews layer on top and progressively take over as the primary data source as real visits accumulate.

---

## Environment variables

```
YELP_API_KEY=<yelp-fusion-api-key>
FOURSQUARE_API_KEY=<foursquare-api-key>
N8N_WEBHOOK_SECRET=<secret-to-protect-enrichment-endpoints>
```

`N8N_WEBHOOK_SECRET` protects all `/enrichment/*` endpoints via the `x-n8n-secret` header. `N8N_WEBHOOK_URL` is no longer used.

Gemini must be on the **paid tier** (1000 RPM). Free tier is capped at 20 requests/day, which is insufficient for bulk enrichment.

---

## Manual trigger

```bash
# Kick off a full enrichment run (runs in background, responds immediately)
curl -X POST https://sensemap-production.up.railway.app/enrichment/trigger \
  -H "x-n8n-secret: YOUR_SECRET"

# Check how many locations still need enrichment
curl https://sensemap-production.up.railway.app/enrichment/stale \
  -H "x-n8n-secret: YOUR_SECRET" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Stale:', d['count'])"
```

---

## Monitoring

- Railway deploy logs: search `[Enrichment]` for start/done/error lines
- `EnrichmentLog` table: full history of every enrichment update (query via Prisma Studio)
- `Location.lastEnrichedAt` — when each location was last processed
- `Location.dataSource` — `"yelp"`, `"foursquare"`, `"reddit"`, comma-separated combos, or `"category"` (unenriched)

---

## Score blending (`displayScores`)

`GET /locations/:id` returns a `displayScores` field showing which source is driving the scores:

| Condition | Source label | Logic |
|---|---|---|
| ≥ 5 community reviews | `community` | Pure community scores |
| 1–4 reviews + enrichment data | `community` | 70% community + 30% estimated |
| No reviews + enrichment data | `estimated` | Pure AI-estimated scores |
| No data | `category` | Raw default scores |
