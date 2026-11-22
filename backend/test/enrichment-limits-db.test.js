// !!! INTEGRATION TEST: NEEDS A THROWAWAY LOCAL POSTGRES !!!
//  - Refuses to run unless DATABASE_URL's host is localhost / 127.0.0.1.
//  - It DELETES ALL ROWS in the "EnrichmentRun", "EnrichmentLog" and "Location" tables before every test.
//    Never point it at a database whose data you want to keep.
//  - It must NOT run in parallel with the other DB test files (they share one database and wipe each other's
//    rows). Use `npm run test:db`, which sets --test-concurrency=1.
//  - The scraper and Gemini are mocked: no external or paid API is called.
//
// Run (from backend/, with the throwaway database's migrations applied):
//   export DATABASE_URL=postgresql://test@127.0.0.1:55433/freshness_test
//   npm run test:db
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(url)) {
    console.error("Refusing to run: DATABASE_URL must point at a local throwaway database.");
    process.exit(1);
}
process.env.N8N_WEBHOOK_SECRET = "test-secret";
process.env.ENRICHMENT_DELAY_MS = "0";

let geminiFails = false;
const geminiCalls = [];
mock.module("../src/services/scraper.js", { namedExports: {
    fetchAllSources: async ({ name }) => ({ combinedText: `Some text about ${name}.`, sources: ["google"], yelpId: null, osmFacilities: null }),
} });
mock.module("../src/lib/gemini.js", { namedExports: {
    model: { generateContent: async ({ contents }) => {
        geminiCalls.push(contents[0].parts[0].text.match(/for "(.*?)" and extract/)?.[1]);
        if (geminiFails) throw new Error("429 quota exceeded");
        return { response: { text: () => JSON.stringify({ noise_score: 6, lighting_score: 4, crowd_score: 2, confidence: 8, sentiment: "neutral", tags: [], summary: "s" }) } };
    } },
    embeddingModel: {},
} });

const { default: prisma } = await import("../src/lib/prisma.js");
const { runEnrichment, selectLocationsToEnrich } = await import("../src/lib/enrichmentCron.js");
const { default: enrichmentRouter } = await import("../src/routes/enrichment.js");
const { default: express } = await import("express");

const DAY = 24 * 3600 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(25); } return false; };
// n stale places P1..Pn; P1 is the OLDEST (enriched longest ago)
const seed = async (n) => { for (let i = 1; i <= n; i++) await prisma.location.create({ data: { name: `P${i}`, latitude: 43.6, longitude: -79.4, lastEnrichedAt: daysAgo(30 - i) } }); };
const names = (rows) => rows.map((r) => r.name);

let server, base;
before(async () => {
    const app = express(); app.use("/enrichment", enrichmentRouter);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await prisma.$disconnect(); });
beforeEach(async () => {
    await prisma.enrichmentRun.deleteMany(); await prisma.enrichmentLog.deleteMany(); await prisma.location.deleteMany();
    geminiFails = false; geminiCalls.length = 0;
    delete process.env.ENRICHMENT_MAX_PER_RUN;
});

test("selection is capped, oldest first, and force=true is capped too (real Postgres)", async () => {
    await seed(8);
    process.env.ENRICHMENT_MAX_PER_RUN = "3";
    assert.deepEqual(names(await selectLocationsToEnrich({ force: false })), ["P1", "P2", "P3"]);
    assert.deepEqual(names(await selectLocationsToEnrich({ force: true })), ["P1", "P2", "P3"], "force=true must not be unbounded");
    assert.deepEqual(names(await selectLocationsToEnrich({ force: true, limit: 5 })), ["P1", "P2", "P3", "P4", "P5"]);
    assert.equal((await selectLocationsToEnrich({ force: true, limit: 100000 })).length, 8, "ceiling is 1000, only 8 exist");
    delete process.env.ENRICHMENT_MAX_PER_RUN;
    assert.equal((await selectLocationsToEnrich({ force: false })).length, 8, "default 50 > 8 places");
});

test("five consecutive Gemini failures finish the run as failed, release the lock, and a new run can start", async () => {
    await seed(7);
    geminiFails = true;
    const id = await runEnrichment({ force: false, trigger: "test" });
    const run = await prisma.enrichmentRun.findUnique({ where: { id } });
    assert.equal(run.status, "failed");
    assert.match(run.errorMessage, /Stopped early after 5 consecutive Gemini failures/);
    assert.ok(run.finishedAt instanceof Date);
    assert.deepEqual([run.planned, run.failed, run.updated], [7, 5, 0]);
    assert.equal(geminiCalls.length, 5);
    assert.equal(await prisma.enrichmentRun.count({ where: { status: "running" } }), 0, "lock released");
    // nothing was written for any place
    assert.equal(await prisma.location.count({ where: { estimatedNoiseScore: { not: null } } }), 0);

    // the very next run starts (no 409 / null) and succeeds once Gemini works again
    geminiFails = false; geminiCalls.length = 0;
    const id2 = await runEnrichment({ force: false, trigger: "test" });
    assert.ok(id2 && id2 !== id);
    assert.equal((await prisma.enrichmentRun.findUnique({ where: { id: id2 } })).status, "success");
    assert.equal(await prisma.enrichmentRun.count(), 2);
});

test("POST /enrichment/trigger?limit=2 processes exactly 2 (the oldest) and rejects a bad limit before locking", async () => {
    await seed(5);
    const r = await fetch(base + "/enrichment/trigger?limit=2", { method: "POST", headers: { "x-n8n-secret": "test-secret" } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).limit, 2);
    assert.ok(await waitFor(async () => (await prisma.enrichmentRun.count({ where: { status: { not: "running" } } })) === 1), "the run finished");
    const run = await prisma.enrichmentRun.findFirst();
    assert.equal(run.status, "success"); assert.equal(run.planned, 2); assert.equal(run.updated, 2); assert.equal(run.trigger, "trigger");
    assert.deepEqual([...geminiCalls].sort(), ["P1", "P2"]);

    const bad = await fetch(base + "/enrichment/trigger?limit=0", { method: "POST", headers: { "x-n8n-secret": "test-secret" } });
    assert.equal(bad.status, 400);
    assert.equal(await prisma.enrichmentRun.count(), 1, "the bad request created no run");
});

test("POST /enrichment/trigger?force=true&limit=3 is capped at 3 even though force ignores staleness", async () => {
    await seed(6);
    await prisma.location.updateMany({ data: { lastEnrichedAt: new Date() } });      // nothing is stale
    const r = await fetch(base + "/enrichment/trigger?force=true&limit=3", { method: "POST", headers: { "x-n8n-secret": "test-secret" } });
    assert.equal((await r.json()).limit, 3);
    assert.ok(await waitFor(async () => (await prisma.enrichmentRun.count({ where: { status: { not: "running" } } })) === 1));
    const run = await prisma.enrichmentRun.findFirst();
    assert.equal(run.planned, 3); assert.equal(run.trigger, "trigger-force"); assert.equal(run.force, true);
});

test("GET /enrichment/stale previews the next run: same places, same cap", async () => {
    await seed(6);
    const res = await fetch(base + "/enrichment/stale?limit=2", { headers: { "x-n8n-secret": "test-secret" } });
    const body = await res.json();
    assert.equal(body.count, 2); assert.equal(body.limit, 2);
    assert.deepEqual(names(body.locations), ["P1", "P2"]);
    const preview = (await selectLocationsToEnrich({ force: false, limit: 2 })).map((l) => l.id);
    assert.deepEqual(body.locations.map((l) => l.id), preview, "preview == what the run selects");
});
