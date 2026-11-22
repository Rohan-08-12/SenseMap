// Run: node --experimental-test-module-mocks --test test/enrichment-limits.test.js
// No database, no network: prisma, the scraper and Gemini are mocked.
import { test, mock, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.N8N_WEBHOOK_SECRET = "test-secret";
process.env.ENRICHMENT_DELAY_MS = "0";             // keep runs fast; the delay itself is tested explicitly below

// ---- mocks -------------------------------------------------------------------------------------------
const findManyArgs = [];      // every prisma.location.findMany(args)
const updates = [];           // every prisma.location.update({ data })
const runCreates = [], runUpdates = [];
let locationRows = [];        // what location.findMany returns
let geminiBehaviour = () => ({ ok: true });   // (placeName) => { ok: true } | { error: "..." }
const geminiCalls = [];
const logLines = [];
const noTextNames = new Set();   // places whose sources return no text (so Gemini is never called for them)
let updateThrows = false;        // make prisma.location.update fail (a non-Gemini error)

const prismaMock = {
    location: {
        findMany: async (args) => { findManyArgs.push(args); return locationRows; },
        update: async ({ data }) => { if (updateThrows) throw new Error("db write failed"); updates.push(data); return {}; },
    },
    enrichmentLog: { create: async () => ({}), findMany: async () => [] },
    enrichmentRun: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }) => { runCreates.push(data); return { id: "run1", force: false, ...data }; },
        update: async ({ data }) => { runUpdates.push(data); return {}; },
    },
};
mock.module("../src/lib/prisma.js", { defaultExport: prismaMock });
mock.module("../src/services/scraper.js", { namedExports: {
    fetchAllSources: async ({ name }) => ({ combinedText: noTextNames.has(name) ? "" : `text about ${name}`, sources: ["google"], yelpId: null, osmFacilities: null }),
} });
mock.module("../src/lib/gemini.js", { namedExports: {
    model: { generateContent: async ({ contents }) => {
        const name = contents[0].parts[0].text.match(/Analyze these reviews for "(.*?)" and extract/)?.[1];
        geminiCalls.push(name);
        const b = geminiBehaviour(name);
        if (b.error) throw new Error(b.error);
        return { response: { text: () => JSON.stringify({ noise_score: 6, lighting_score: 4, crowd_score: 2, confidence: 8, sentiment: "neutral", tags: [], summary: "s" }) } };
    } },
    embeddingModel: {},
} });

const cfg = await import("../src/lib/enrichmentConfig.js");
const { selectLocationsToEnrich } = await import("../src/lib/enrichmentCron.js");

const place = (i) => ({ id: `loc${i}`, name: `Place ${i}`, latitude: 43.6, longitude: -79.4, category: "cafe", externalYelpId: null, googlePlaceId: `g${i}`, estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null, lastEnrichedAt: null });
const places = (n) => Array.from({ length: n }, (_, i) => place(i + 1));

const originalEnv = { max: process.env.ENRICHMENT_MAX_PER_RUN };
beforeEach(() => {
    findManyArgs.length = 0; updates.length = 0; runCreates.length = 0; runUpdates.length = 0; geminiCalls.length = 0; logLines.length = 0;
    locationRows = []; geminiBehaviour = () => ({ ok: true }); noTextNames.clear(); updateThrows = false;
    delete process.env.ENRICHMENT_MAX_PER_RUN;
});
after(() => { if (originalEnv.max === undefined) delete process.env.ENRICHMENT_MAX_PER_RUN; });

// ---- 1. ENRICHMENT_MAX_PER_RUN ---------------------------------------------------------------------------
test("maxPerRun: default 50; clamped to 1-1000; garbage falls back to the default", () => {
    assert.equal(cfg.maxPerRun({}), 50);
    assert.equal(cfg.maxPerRun({ ENRICHMENT_MAX_PER_RUN: "25" }), 25);
    assert.equal(cfg.maxPerRun({ ENRICHMENT_MAX_PER_RUN: "0" }), 1);
    assert.equal(cfg.maxPerRun({ ENRICHMENT_MAX_PER_RUN: "-7" }), 1);
    assert.equal(cfg.maxPerRun({ ENRICHMENT_MAX_PER_RUN: "5000" }), 1000);
    assert.equal(cfg.maxPerRun({ ENRICHMENT_MAX_PER_RUN: "12.9" }), 12);
    for (const bad of ["", "  ", "abc", "NaN", undefined]) assert.equal(cfg.maxPerRun({ ENRICHMENT_MAX_PER_RUN: bad }), 50, String(bad));
});

test("resolveLimit: an explicit limit is clamped to 1-1000, otherwise the env cap applies", () => {
    assert.equal(cfg.resolveLimit(undefined, {}), 50);
    assert.equal(cfg.resolveLimit(undefined, { ENRICHMENT_MAX_PER_RUN: "30" }), 30);
    assert.equal(cfg.resolveLimit("25", { ENRICHMENT_MAX_PER_RUN: "30" }), 25);
    assert.equal(cfg.resolveLimit(200, { ENRICHMENT_MAX_PER_RUN: "30" }), 200);     // a manual batch may exceed the nightly cap...
    assert.equal(cfg.resolveLimit(99999, {}), 1000);                                // ...but never the 1000 ceiling
    assert.equal(cfg.resolveLimit(0, {}), 1);
    assert.equal(cfg.resolveLimit("junk", { ENRICHMENT_MAX_PER_RUN: "30" }), 30);
});

test("selectLocationsToEnrich: every selection has a take, forced runs included (never unbounded)", async () => {
    await selectLocationsToEnrich({ force: false });
    assert.equal(findManyArgs.at(-1).take, 50);

    await selectLocationsToEnrich({ force: true });
    assert.equal(findManyArgs.at(-1).take, 50, "force=true must also be capped");
    assert.deepEqual(findManyArgs.at(-1).where, {}, "force still ignores staleness");

    process.env.ENRICHMENT_MAX_PER_RUN = "7";
    await selectLocationsToEnrich({ force: true });
    assert.equal(findManyArgs.at(-1).take, 7);
    await selectLocationsToEnrich({ force: false });
    assert.equal(findManyArgs.at(-1).take, 7);

    process.env.ENRICHMENT_MAX_PER_RUN = "999999";
    await selectLocationsToEnrich({ force: true });
    assert.equal(findManyArgs.at(-1).take, 1000);

    await selectLocationsToEnrich({ force: true, limit: 3 });
    assert.equal(findManyArgs.at(-1).take, 3);
    assert.deepEqual(findManyArgs.at(-1).orderBy, [{ lastEnrichedAt: { sort: "asc", nulls: "first" } }], "oldest first, so batches make progress");
});

// ---- 2. ENRICHMENT_DELAY_MS ----------------------------------------------------------------------------------
const { runEnrichment } = await import("../src/lib/enrichmentCron.js");

test("delayMs: default 2000; clamped to 0-60000; garbage falls back to the default", () => {
    assert.equal(cfg.delayMs({}), 2000);
    assert.equal(cfg.delayMs({ ENRICHMENT_DELAY_MS: "0" }), 0);
    assert.equal(cfg.delayMs({ ENRICHMENT_DELAY_MS: "750" }), 750);
    assert.equal(cfg.delayMs({ ENRICHMENT_DELAY_MS: "-5" }), 0);
    assert.equal(cfg.delayMs({ ENRICHMENT_DELAY_MS: "999999" }), 60000);
    for (const bad of ["", "abc", undefined]) assert.equal(cfg.delayMs({ ENRICHMENT_DELAY_MS: bad }), 2000, String(bad));
});

test("a run pauses ENRICHMENT_DELAY_MS between places (not after the last), and not at all at 0", async () => {
    locationRows = places(3);

    process.env.ENRICHMENT_DELAY_MS = "0";
    let t = Date.now();
    await runEnrichment({ force: false, trigger: "test" });
    assert.ok(Date.now() - t < 400, "no pause at 0");

    process.env.ENRICHMENT_DELAY_MS = "300";
    t = Date.now();
    await runEnrichment({ force: false, trigger: "test" });
    const took = Date.now() - t;
    assert.ok(took >= 600, `2 pauses of 300ms expected, took ${took}ms`);
    assert.ok(took < 1500, `but not a pause after the last place, took ${took}ms`);
    process.env.ENRICHMENT_DELAY_MS = "0";
});

// ---- 3. POST /enrichment/trigger ?limit= and GET /enrichment/stale preview -------------------------------------
const http = await import("node:http");
const { default: express } = await import("express");
const { default: enrichmentRouter } = await import("../src/routes/enrichment.js");

let server, base;
before(async () => {
    const app = express(); app.use("/enrichment", enrichmentRouter);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const H = { "x-n8n-secret": "test-secret" };
const post = (path) => fetch(base + path, { method: "POST", headers: H });
const get = (path, headers = H) => fetch(base + path, { headers });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runFinished = async () => { for (let i = 0; i < 200; i++) { if (runUpdates.some((u) => u.finishedAt)) return true; await sleep(10); } return false; };

test("POST /trigger?limit=25: the limit reaches the selection and is echoed back", async () => {
    locationRows = places(2);
    const r = await post("/enrichment/trigger?limit=25");
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.triggered, true); assert.equal(body.limit, 25); assert.equal(body.force, false); assert.equal(body.runId, "run1");
    assert.ok(await runFinished());
    assert.equal(findManyArgs.at(-1).take, 25);
    assert.equal(runCreates[0].trigger, "trigger");
});

test("POST /trigger?force=true&limit=25: force and limit combine (still capped)", async () => {
    locationRows = places(1);
    const body = await (await post("/enrichment/trigger?force=true&limit=25")).json();
    assert.equal(body.force, true); assert.equal(body.limit, 25);
    assert.ok(await runFinished());
    assert.equal(findManyArgs.at(-1).take, 25);
    assert.deepEqual(findManyArgs.at(-1).where, {});
    assert.equal(runCreates[0].trigger, "trigger-force");
});

test("POST /trigger without a limit uses ENRICHMENT_MAX_PER_RUN (default 50), forced or not", async () => {
    locationRows = places(1);
    assert.equal((await (await post("/enrichment/trigger?force=true")).json()).limit, 50);
    assert.ok(await runFinished());
    assert.equal(findManyArgs.at(-1).take, 50);
});

test("POST /trigger?limit is clamped to the 1000 ceiling", async () => {
    locationRows = places(1);
    assert.equal((await (await post("/enrichment/trigger?limit=999999")).json()).limit, 1000);
    assert.ok(await runFinished());
    assert.equal(findManyArgs.at(-1).take, 1000);
});

test("POST /trigger rejects a bad limit with 400 before it takes the lock", async () => {
    for (const bad of ["0", "-5", "abc", "2.5", "", "1e3", "10;drop", "5&limit=6"]) {
        const r = await post(`/enrichment/trigger?limit=${encodeURIComponent(bad)}`);
        assert.equal(r.status, 400, `limit=${bad}`);
        assert.match((await r.json()).error, /positive integer/);
    }
    assert.equal(runCreates.length, 0, "no run was started");
    assert.equal(findManyArgs.length, 0);
});

test("POST /trigger still returns 409 while a run is active, and requires the secret", async () => {
    const original = prismaMock.enrichmentRun.create;
    prismaMock.enrichmentRun.create = async () => { throw Object.assign(new Error("unique"), { code: "P2002" }); };
    try {
        const r = await post("/enrichment/trigger?limit=10");
        assert.equal(r.status, 409);
        assert.equal((await r.json()).triggered, false);
    } finally { prismaMock.enrichmentRun.create = original; }
    assert.equal((await fetch(base + "/enrichment/trigger", { method: "POST" })).status, 401);
});

test("GET /stale previews the same selection: same cap, force, backoff and a limit param", async () => {
    locationRows = places(3);
    let body = await (await get("/enrichment/stale")).json();
    assert.equal(body.limit, 50); assert.equal(body.force, false); assert.equal(body.count, 3);
    assert.equal(findManyArgs.at(-1).take, 50);
    assert.ok("OR" in findManyArgs.at(-1).where, "stale rule applies");
    assert.ok("lastEnrichedAt" in body.locations[0] && "externalYelpId" in body.locations[0], "preview rows keep the fields n8n reads");

    body = await (await get("/enrichment/stale?limit=7")).json();
    assert.equal(body.limit, 7); assert.equal(findManyArgs.at(-1).take, 7);

    body = await (await get("/enrichment/stale?force=true&limit=7")).json();
    assert.equal(body.force, true); assert.deepEqual(findManyArgs.at(-1).where, {});

    assert.equal((await get("/enrichment/stale?limit=0")).status, 400);
    assert.equal((await get("/enrichment/stale", {})).status, 401);
});

test("ENRICHMENT_MAX_PER_RUN applies to trigger and stale alike", async () => {
    process.env.ENRICHMENT_MAX_PER_RUN = "5";
    locationRows = places(1);
    await get("/enrichment/stale");
    assert.equal(findManyArgs.at(-1).take, 5);
    await post("/enrichment/trigger?force=true");
    assert.ok(await runFinished());
    assert.equal(findManyArgs.at(-1).take, 5);
});

// ---- 4. stop early after 5 consecutive Gemini failures --------------------------------------------------------------
const finalRun = () => runUpdates.findLast((u) => u.finishedAt);
const failing = (set) => (name) => (set.has(name) ? { error: "429 quota exceeded" } : { ok: true });

test("5 Gemini failures in a row stop the run: status failed, reason recorded, lock released, no more Gemini calls", async () => {
    locationRows = places(8);
    geminiBehaviour = () => ({ error: "429 quota exceeded" });
    const id = await runEnrichment({ force: false, trigger: "test" });
    assert.equal(id, "run1");
    assert.equal(geminiCalls.length, 5, "the run stopped after the 5th failure instead of burning 8 calls");
    const f = finalRun();
    assert.equal(f.status, "failed");
    assert.match(f.errorMessage, /Stopped early after 5 consecutive Gemini failures/);
    assert.match(f.errorMessage, /429 quota exceeded/);
    assert.ok(f.finishedAt instanceof Date, "finishing the row releases the lock");
    assert.equal(f.planned, 8); assert.equal(f.failed, 5);
    assert.equal(f.errors.length, 5);
    assert.equal(updates.length, 0);
});

test("a successful Gemini call resets the streak (4 failures, a success, 4 failures: no early stop)", async () => {
    locationRows = places(10);
    geminiBehaviour = failing(new Set(["Place 1", "Place 2", "Place 3", "Place 4", "Place 6", "Place 7", "Place 8", "Place 9"]));
    await runEnrichment({ force: false, trigger: "test" });
    assert.equal(geminiCalls.length, 10, "every place was attempted");
    const f = finalRun();
    assert.equal(f.status, "success");
    assert.equal(f.errorMessage ?? null, null);
    assert.equal(f.failed, 8);
});

test("only Gemini failures count: database errors don't extend the streak", async () => {
    locationRows = places(7);
    updateThrows = true;
    await runEnrichment({ force: false, trigger: "test" });
    assert.equal(geminiCalls.length, 7, "no early stop for non-Gemini errors");
    const f = finalRun();
    assert.equal(f.status, "failed");
    assert.equal(f.errorMessage, "Every location failed");
});

test("places with no text neither extend nor reset the streak", async () => {
    locationRows = places(6);
    noTextNames.add("Place 5");
    geminiBehaviour = (name) => (name === "Place 5" ? { ok: true } : { error: "boom" });
    await runEnrichment({ force: false, trigger: "test" });
    // fails: 1,2,3,4 (streak 4), place 5 has no text (no Gemini call, streak stays 4), place 6 fails -> streak 5 -> stop
    assert.deepEqual(geminiCalls, ["Place 1", "Place 2", "Place 3", "Place 4", "Place 6"]);
    assert.match(finalRun().errorMessage, /Stopped early/);
});

test("4 failures at the end of the list is not an early stop", async () => {
    locationRows = places(4);
    geminiBehaviour = () => ({ error: "boom" });
    await runEnrichment({ force: false, trigger: "test" });
    assert.equal(geminiCalls.length, 4);
    assert.equal(finalRun().errorMessage, "Every location failed");   // the pre-existing all-failed rule, not the streak
});

test("an unparseable Gemini response counts as a Gemini failure", async () => {
    const { GeminiRequestError, requestAnalysis } = await import("../src/lib/enrichmentAnalysis.js");
    const badModel = { generateContent: async () => ({ response: { text: () => "not json" } }) };
    await assert.rejects(requestAnalysis(badModel, "X", "text"), (e) => e instanceof GeminiRequestError);
    const throwing = { generateContent: async () => { throw new Error("quota"); } };
    await assert.rejects(requestAnalysis(throwing, "X", "text"), (e) => e instanceof GeminiRequestError && /quota/.test(e.message));
});
