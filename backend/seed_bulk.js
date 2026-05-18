/**
 * seed_bulk.js — Bulk-seeds Toronto locations via the /discover endpoint.
 *
 * For each search query, the backend hits Google Places, pulls real photos +
 * reviews, runs Gemini analysis, and stores everything in the DB automatically.
 * This populates the map with real sensory scores without visiting anywhere.
 *
 * Requirements: backend must be running on PORT (default 3000).
 *
 * Usage:
 *   node seed_bulk.js              ← full run (all queries)
 *   node seed_bulk.js --dry-run    ← print queries only, no requests
 *   node seed_bulk.js --delay 5000 ← ms between requests (default 3000)
 */

import "dotenv/config";

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;

// Toronto city centre coordinates
const LAT = 43.6532;
const LNG = -79.3832;

// Search queries — plain place-type searches Google Places understands
const QUERIES = [
  // Libraries
  "public library Toronto",
  "public library Scarborough",
  "public library North York",
  "public library Etobicoke",
  "public library Mississauga",

  // Cafes by neighbourhood
  "cafe Toronto downtown",
  "coffee shop Kensington Market Toronto",
  "cafe Annex Toronto",
  "cafe Leslieville Toronto",
  "cafe Yorkville Toronto",
  "coffee shop Liberty Village Toronto",
  "cafe Bloor West Village Toronto",
  "cafe The Junction Toronto",

  // Parks & nature
  "park Toronto",
  "nature trail Toronto",
  "botanical garden Toronto",
  "ravine park Toronto",
  "waterfront park Toronto",
  "conservation area Toronto",

  // Museums & galleries
  "art gallery Toronto",
  "museum Toronto",
  "science centre Toronto",
  "aquarium Toronto",

  // Community & wellness
  "community centre Toronto",
  "recreation centre North York",
  "yoga studio Toronto",
  "meditation centre Toronto",

  // Bookstores
  "bookstore Toronto",
  "book shop Toronto",

  // Restaurants & tea
  "tea house Toronto",
  "bakery Toronto",
  "brunch restaurant Toronto",
  "restaurant Beaches Toronto",
  "restaurant Rosedale Toronto",
  "restaurant Midtown Toronto",
];

// ─── helpers ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const DELAY_MS = (() => {
  const i = args.indexOf("--delay");
  return i !== -1 ? parseInt(args[i + 1], 10) : 3000;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function discoverQuery(query) {
  const url = `${BASE_URL}/discover?q=${encodeURIComponent(query)}&lat=${LAT}&lng=${LNG}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.features) ? data.features.length : 0;
}

// ─── main ────────────────────────────────────────────────────

async function run() {
  console.log(`SenseMap bulk seeder`);
  console.log(`Backend: ${BASE_URL}`);
  console.log(`Queries: ${QUERIES.length}`);
  console.log(`Delay:   ${DELAY_MS}ms between requests`);
  if (DRY_RUN) console.log(`Mode:    DRY RUN — no requests will be made\n`);
  console.log("─".repeat(55));

  // Quick health check
  if (!DRY_RUN) {
    try {
      const health = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5000) });
      if (!health.ok) throw new Error();
      console.log("Backend reachable\n");
    } catch {
      console.error("Cannot reach backend. Make sure it's running: npm run dev:servers");
      process.exit(1);
    }
  }

  let totalFound = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    const prefix = `[${String(i + 1).padStart(2, "0")}/${QUERIES.length}]`;

    if (DRY_RUN) {
      console.log(`${prefix} ${query}`);
      continue;
    }

    process.stdout.write(`${prefix} ${query} ... `);

    try {
      const count = await discoverQuery(query);
      totalFound += count;
      succeeded++;
      console.log(`${count} locations`);
    } catch (err) {
      failed++;
      console.log(`FAILED (${err.message})`);
    }

    if (i < QUERIES.length - 1) await sleep(DELAY_MS);
  }

  if (!DRY_RUN) {
    console.log("─".repeat(55));
    console.log(`Done. ${succeeded}/${QUERIES.length} queries succeeded.`);
    console.log(`Total locations returned: ${totalFound}`);
    if (failed > 0) console.log(`Failed: ${failed} (check backend logs)`);
    console.log(`\nNew locations are now cached in the DB with Gemini-generated`);
    console.log(`sensory scores and SenseMap Bot seed reviews.`);
  }
}

run().catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
