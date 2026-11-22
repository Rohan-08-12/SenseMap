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

// ---- mocks: scraper (with a gate to hold the first run open) and Gemini ---------------------------------
const scraperCalls = [];       // place names the scraper was asked about
const geminiCalls = [];        // place names Gemini was asked about
let gate = null;               // when set, the first scraper call waits for it
const NORMAL = "Normal Place", BACKED_OFF = "Backed-off Place", ALL_NULL = "All-null Place";

mock.module("../src/services/scraper.js", { namedExports: {
    fetchAllSources: async ({ name }) => {
        scraperCalls.push(name);
        if (gate) { const g = gate; gate = null; await g.promise; }
        return { combinedText: `Some text about ${name}.`, sources: ["google"], yelpId: null, osmFacilities: null };
    },
} });
mock.module("../src/lib/gemini.js", { namedExports: {
    model: { generateContent: async ({ contents }) => {
        const prompt = contents[0].parts[0].text;
        const name = prompt.match(/Analyze these reviews for "(.*?)" and extract/)?.[1];
        geminiCalls.push(name);
        const base = { sentiment: "neutral", tags: [], summary: "s" };
        const answer = name === ALL_NULL
            ? { ...base, noise_score: null, lighting_score: null, crowd_score: null, confidence: 2 }
            : { ...base, noise_score: 6, lighting_score: 4, crowd_score: 2, confidence: 8 };
        return { response: { text: () => JSON.stringify(answer) } };
    } },
    embeddingModel: {},
} });

const { default: prisma } = await import("../src/lib/prisma.js");
const { runEnrichment } = await import("../src/lib/enrichmentCron.js");
const { default: enrichmentRouter } = await import("../src/routes/enrichment.js");
const { default: express } = await import("express");

const DAY = 24 * 3600 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn()) return true; await sleep(25); }
    return false;
}

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
    scraperCalls.length = 0; geminiCalls.length = 0; gate = null;
});

test("a tracked nightly run: backoff respected, all-null place gets no estimates, lock refuses a second run and POST /trigger", async () => {
    // ---- seed: three STALE places ----------------------------------------------------------------------
    const mk = (name, enriched) => prisma.location.create({ data: { name, latitude: 43.65, longitude: -79.38, category: "cafe", lastEnrichedAt: daysAgo(enriched) } });
    const normal = await mk(NORMAL, 12);
    const backedOff = await mk(BACKED_OFF, 11);
    const allNull = await mk(ALL_NULL, 10);
    const backedOffEnrichedAt = backedOff.lastEnrichedAt;
    await prisma.enrichmentLog.create({ data: { locationId: backedOff.id, updatedAt: daysAgo(5), scores: { outcome: "incomplete_scores", confidence: 6, sources: ["google"] } } });

    // ---- start the first run and hold it open inside the (mocked) scraper --------------------------------
    let release; gate = { promise: new Promise((r) => { release = r; }) };
    const first = runEnrichment({ force: false, trigger: "test" });
    assert.ok(await waitFor(async () => (await prisma.enrichmentRun.count({ where: { status: "running" } })) === 1), "first run should be recorded as running");

    // ---- while it is running: a second call is refused and starts nothing -----------------------------------
    const second = await runEnrichment({ force: false, trigger: "test" });
    assert.equal(second, null, "runEnrichment returns null (already running) instead of starting another run");
    assert.equal(await prisma.enrichmentRun.count(), 1, "still exactly one EnrichmentRun row");

    // ---- and POST /enrichment/trigger answers 409 ---------------------------------------------------------
    const trig = await fetch(base + "/enrichment/trigger", { method: "POST", headers: { "x-n8n-secret": "test-secret" } });
    assert.equal(trig.status, 409);
    const trigBody = await trig.json();
    assert.equal(trigBody.triggered, false);
    assert.match(trigBody.error, /already in progress/i);
    assert.equal(await prisma.enrichmentRun.count(), 1, "the trigger did not create a run either");
    assert.equal((await prisma.enrichmentRun.findFirst()).status, "running");

    // ---- let the first run finish ------------------------------------------------------------------------
    release();
    const runId = await first;
    assert.ok(runId, "the first run returns its run id");

    // exactly one run row, finished as success
    const runs = await prisma.enrichmentRun.findMany();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, runId);
    assert.equal(runs[0].status, "success");
    assert.equal(runs[0].trigger, "test");
    assert.equal(runs[0].force, false);
    assert.ok(runs[0].finishedAt instanceof Date && runs[0].finishedAt >= runs[0].startedAt);
    assert.deepEqual([runs[0].planned, runs[0].updated, runs[0].skipped, runs[0].failed], [2, 1, 1, 0]);
    assert.equal(await prisma.enrichmentRun.count({ where: { status: "running" } }), 0, "lock released");

    // the backed-off place was never selected, scraped or sent to Gemini
    assert.ok(!scraperCalls.includes(BACKED_OFF), `scraper calls: ${scraperCalls}`);
    assert.ok(!geminiCalls.includes(BACKED_OFF), `gemini calls: ${geminiCalls}`);
    assert.deepEqual([...geminiCalls].sort(), [ALL_NULL, NORMAL].sort());
    const b = await prisma.location.findUnique({ where: { id: backedOff.id } });
    assert.equal(b.lastEnrichedAt.getTime(), backedOffEnrichedAt.getTime(), "backed-off place untouched");
    assert.equal(b.enrichmentConfidence, null);
    assert.equal(b.estimatedNoiseScore, null);

    // the normal place got its estimates (6/4/2 -> 3/2/1) and its confidence
    const n = await prisma.location.findUnique({ where: { id: normal.id } });
    assert.deepEqual([n.estimatedNoiseScore, n.estimatedLightingScore, n.estimatedCrowdScore], [3, 2, 1]);
    assert.equal(n.enrichmentConfidence, 8);

    // the all-null place: NO estimates, confidence stored, marked enriched (so it is not retried nightly)
    const z = await prisma.location.findUnique({ where: { id: allNull.id } });
    assert.equal(z.estimatedNoiseScore, null);
    assert.equal(z.estimatedLightingScore, null);
    assert.equal(z.estimatedCrowdScore, null);
    assert.equal(z.enrichmentConfidence, 2);
    assert.ok(Date.now() - z.lastEnrichedAt.getTime() < 60_000, "marked enriched just now");

    // log rows: the backed-off place's original row, plus one score row for the normal place; nothing for all-null
    const logs = await prisma.enrichmentLog.findMany();
    assert.equal(logs.length, 2);
    assert.deepEqual(logs.map((l) => l.locationId).sort(), [backedOff.id, normal.id].sort());
});
