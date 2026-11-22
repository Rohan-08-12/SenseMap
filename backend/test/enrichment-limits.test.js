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

const prismaMock = {
    location: {
        findMany: async (args) => { findManyArgs.push(args); return locationRows; },
        update: async ({ data }) => { updates.push(data); return {}; },
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
    fetchAllSources: async ({ name }) => ({ combinedText: `text about ${name}`, sources: ["google"], yelpId: null, osmFacilities: null }),
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

const place = (i) => ({ id: `loc${i}`, name: `Place ${i}`, latitude: 43.6, longitude: -79.4, category: "cafe", externalYelpId: null, googlePlaceId: `g${i}`, estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null });
const places = (n) => Array.from({ length: n }, (_, i) => place(i + 1));

const originalEnv = { max: process.env.ENRICHMENT_MAX_PER_RUN };
beforeEach(() => {
    findManyArgs.length = 0; updates.length = 0; runCreates.length = 0; runUpdates.length = 0; geminiCalls.length = 0; logLines.length = 0;
    locationRows = []; geminiBehaviour = () => ({ ok: true });
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
