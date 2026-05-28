# SenseMap n8n Enrichment Pipeline

Automatically enriches location data with Yelp reviews analyzed by Gemini + Claude. Runs nightly at 4am Toronto time and processes up to 450 stale locations per run (500ms delay between calls to stay within Yelp's 500 req/day free tier).

## How it works

1. **Schedule Trigger** fires at 4am Toronto time (or Webhook Trigger for manual runs)
2. `GET /enrichment/stale` fetches up to 450 locations with no enrichment or enrichment older than 24h
3. Locations are processed in batches of 10
4. `POST /enrichment/location` for each location:
   - Searches Yelp for the business by name + coordinates
   - Fetches up to 10 recent Yelp reviews
   - Runs Gemini + Claude analysis to extract sensory scores (1-10 → stored as 1-5)
   - Updates the DB only if scores differ by > 0.5 or location was never enriched
   - Logs the update to `EnrichmentLog`
5. 500ms wait between each call

At 450 locations/day, the full database of ~3,775 locations enriches in ~9 days on the first run.

## Setup

### 1. Prerequisites

- n8n instance (cloud or self-hosted): https://n8n.io
- Yelp Fusion API key (free tier: 500 req/day): https://www.yelp.com/developers
- SenseMap backend running and reachable from n8n

### 2. Add environment variables

**Backend `.env` (and Railway):**

```
YELP_API_KEY=<your-yelp-api-key>
N8N_WEBHOOK_URL=<your-n8n-webhook-url>      # from step 4
N8N_WEBHOOK_SECRET=<random-secret-string>   # generate with: openssl rand -hex 32
```

**n8n environment:**

```
SENSEMAP_API_URL=https://your-backend.railway.app  # no trailing slash
```

### 3. Import the workflow

1. Open n8n → Workflows → Import from File
2. Select `n8n/sensemap-enrichment-workflow.json`

### 4. Configure credentials in n8n

**HTTP Header Auth credential** (name it exactly `SenseMap N8N Secret`):
- Header Name: `x-n8n-secret`
- Header Value: the same value as `N8N_WEBHOOK_SECRET` in your backend

**Postgres credential** (name it `SenseMap Postgres`):
- Use the same `DATABASE_URL` connection string from your backend `.env`
- Or set Host/Port/DB/User/Password individually from the Supabase connection details

### 5. Get the Webhook URL

1. In n8n, click the **Webhook Trigger** node
2. Copy the **Production URL** (looks like `https://your-n8n.com/webhook/sensemap-enrichment`)
3. Paste it into `N8N_WEBHOOK_URL` in your backend `.env` and Railway

### 6. Activate the workflow

Toggle the workflow to **Active** in n8n. It will now run every night at 4am Toronto time.

### Manual trigger

To kick off an enrichment run immediately:

```bash
curl -X POST https://your-backend.railway.app/enrichment/trigger \
  -H "x-n8n-secret: YOUR_SECRET"
```

Or POST directly to the n8n webhook URL.

## Score blending (`getDisplayScore`)

After enrichment, `GET /locations/:id` returns a `displayScores` field:

| Condition | Source | Logic |
|---|---|---|
| ≥ 5 community reviews | `community` | Pure community scores |
| 1-4 reviews + Yelp data | `community` | 70% community + 30% Yelp |
| No reviews + Yelp data | `estimated` | Pure Yelp-estimated scores |
| No data | `category` | Raw scores (may be null) |

## Monitoring

- Enrichment runs are logged to the `EnrichmentLog` table (query via Prisma Studio)
- `Location.lastEnrichedAt` tracks when each location was last processed
- `Location.enrichmentConfidence` stores the AI confidence score (1-10)
- `Location.dataSource` is `"yelp"` for enriched locations, `"category"` for unenriched
