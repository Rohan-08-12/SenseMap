// Run: node --experimental-test-module-mocks --test test/enrichment-validation.test.js
// No database, no network: prisma, the scraper and Gemini are all mocked. Nothing here can call a paid API.
import { test, mock, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.N8N_WEBHOOK_SECRET = "test-secret";

// ---- mocks -------------------------------------------------------------------------------
const updates = [];          // every prisma.location.update({ data }) call
const findManyArgs = [];     // every prisma.location.findMany(args)
const runCreates = [];       // every prisma.enrichmentRun.create({ data }) (lock acquisitions)
const runUpdates = [];       // every prisma.enrichmentRun.update({ data }) (heartbeats and the final status)
const logFindManyArgs = [];  // every prisma.enrichmentLog.findMany(args)
let backoffRows = [];        // rows the mocked enrichmentLog.findMany returns (places in incomplete-scores backoff)
let osmFacilities = null;
const logs = [];             // every enrichmentLog.create call
let geminiCalls = 0;
let geminiResponse = {};     // what the mocked Gemini returns (object, or a raw string)
let sourceText = "A quiet cafe on a side street.";
const baseLocation = { id: "loc1", name: "Test Place", latitude: 43.6, longitude: -79.4, category: "cafe",
    externalYelpId: null, googlePlaceId: "g1", estimatedNoiseScore: null, estimatedLightingScore: null,
    estimatedCrowdScore: null, lastEnrichedAt: null };
let currentLocation = baseLocation;

const prismaMock = {
    location: {
        findMany: async (args) => { findManyArgs.push(args); return [currentLocation]; },
        findUnique: async () => currentLocation,
        update: async ({ data }) => { updates.push(data); return {}; },
    },
    enrichmentLog: {
        create: async ({ data }) => { logs.push(data); return {}; },
        findMany: async (args) => { logFindManyArgs.push(args); return backoffRows; },
    },
    // run tracking + lock (lib/enrichmentRuns.js): runEnrichment now claims a run row before doing any work
    enrichmentRun: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }) => { runCreates.push(data); return { id: "run1", force: false, ...data }; },
        update: async ({ data }) => { runUpdates.push(data); return {}; },
    },
};
mock.module("../src/lib/prisma.js", { defaultExport: prismaMock });
mock.module("../src/services/scraper.js", { namedExports: {
    fetchAllSources: async () => ({ combinedText: sourceText, sources: ["google"], yelpId: null, osmFacilities }),
} });
mock.module("../src/lib/gemini.js", { namedExports: {
    model: { generateContent: async () => { geminiCalls++; return { response: { text: () => typeof geminiResponse === "string" ? geminiResponse : JSON.stringify(geminiResponse) } }; } },
    embeddingModel: {},
} });

const { isValidRawScore, validateScores } = await import("../src/lib/scoreValidation.js");
const { runEnrichment } = await import("../src/lib/enrichmentCron.js");
const { default: enrichmentRouter } = await import("../src/routes/enrichment.js");
const { default: express } = await import("express");

const good = { noise_score: 6, lighting_score: 4, crowd_score: 2, confidence: 8, sentiment: "neutral", tags: [], summary: "s" };

let server, base;
before(async () => {
    const app = express(); app.use(express.json()); app.use("/enrichment", enrichmentRouter);
    server = http.createServer(app);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { runCreates.length = 0; runUpdates.length = 0; findManyArgs.length = 0; logFindManyArgs.length = 0; backoffRows = []; osmFacilities = null; updates.length = 0; logs.length = 0; geminiCalls = 0; currentLocation = baseLocation; sourceText = "A quiet cafe on a side street."; });

// run the same Gemini response through BOTH writers
async function viaCron(resp) { geminiResponse = resp; await runEnrichment({ force: true }); return { updates: [...updates] }; }
async function viaRoute(resp) {
    geminiResponse = resp;
    const res = await fetch(base + "/enrichment/location", { method: "POST", headers: { "content-type": "application/json", "x-n8n-secret": "test-secret" }, body: JSON.stringify({ locationId: "loc1" }) });
    return { body: await res.json(), updates: [...updates] };
}
const wroteScores = (us) => us.some(d => "estimatedNoiseScore" in d);

// ---- 1. validator ------------------------------------------------------------------------
test("isValidRawScore: accepts only finite numbers in 1-10", () => {
    for (const v of [1, 1.5, 5, 10]) assert.equal(isValidRawScore(v), true, String(v));
    // each row of the earlier table, plus the other ways a value can be bad
    for (const v of [undefined, null, NaN, Infinity, -Infinity, 0, -3, 0.9, 10.1, 15, "low", "7", "", true, [], {}]) {
        assert.equal(isValidRawScore(v), false, `should reject ${JSON.stringify(v)} (${typeof v})`);
    }
});

test("validateScores halves valid scores and never coerces a bad one", () => {
    assert.deepEqual(validateScores({ noise_score: 6, lighting_score: 4, crowd_score: 2 }), { ok: true, noise: 3, lighting: 2, crowd: 1 });
    assert.deepEqual(validateScores({ noise_score: 1, lighting_score: 1, crowd_score: 1 }), { ok: true, noise: 0.5, lighting: 0.5, crowd: 0.5 });
    for (const bad of [
        { lighting_score: 4, crowd_score: 2 },                                   // missing
        { noise_score: undefined, lighting_score: 4, crowd_score: 2 },
        { noise_score: null, lighting_score: 4, crowd_score: 2 },
        { noise_score: NaN, lighting_score: 4, crowd_score: 2 },
        { noise_score: "low", lighting_score: 4, crowd_score: 2 },               // non-numeric string
        { noise_score: "7", lighting_score: 4, crowd_score: 2 },                 // numeric string: not coerced either
        { noise_score: 0, lighting_score: 4, crowd_score: 2 },
        { noise_score: 15, lighting_score: 4, crowd_score: 2 },                  // out of range high
        { noise_score: 6, lighting_score: 4, crowd_score: -1 },
    ]) assert.deepEqual(validateScores(bad), { ok: false, reason: "invalid_scores" }, JSON.stringify(bad));
    assert.equal(validateScores(undefined).ok, false);
});

// ---- both writers -------------------------------------------------------------------------
for (const [name, run] of [["nightly cron", viaCron], ["POST /enrichment/location", viaRoute]]) {
    test(`${name}: valid scores are written (halved)`, async () => {
        const r = await run({ ...good });
        const w = r.updates.find(d => "estimatedNoiseScore" in d);
        assert.ok(w, "scores should be written");
        assert.deepEqual([w.estimatedNoiseScore, w.estimatedLightingScore, w.estimatedCrowdScore], [3, 2, 1]);
    });

    for (const [label, patch] of [
        ["missing score", { noise_score: undefined }],
        ["null score", { noise_score: null }],
        ["NaN-producing string", { noise_score: "low" }],
        ["numeric string", { noise_score: "7" }],
        ["zero", { noise_score: 0 }],
        ["out of range (15)", { noise_score: 15 }],
    ]) {
        test(`${name}: ${label} is rejected, nothing is written`, async () => {
            const r = await run({ ...good, ...patch });
            assert.equal(wroteScores(r.updates), false);
            // no score-history row; the only thing ever logged is the incomplete_scores outcome (a lone null score)
            assert.ok(logs.every((l) => l.scores.outcome === "incomplete_scores"));
        });
    }

    test(`${name}: an all-1 answer is still accepted (it is a legal value)`, async () => {
        const r = await run({ ...good, noise_score: 1, lighting_score: 1, crowd_score: 1 });
        const w = r.updates.find(d => "estimatedNoiseScore" in d);
        assert.deepEqual([w.estimatedNoiseScore, w.estimatedLightingScore, w.estimatedCrowdScore], [0.5, 0.5, 0.5]);
    });
}

test("the route reports the rejection reason", async () => {
    const r = await viaRoute({ ...good, noise_score: "low" });
    assert.equal(r.body.updated, false);
    assert.equal(r.body.reason, "invalid_scores");
});

test("no test in this file can reach Gemini", () => { assert.ok(geminiCalls >= 0); });

// ---- 2. nullable scores, shared schema/prompt ------------------------------------------------
const { analyzeSchema, buildAnalysisPrompt, interpretAnalysis } = await import("../src/lib/enrichmentAnalysis.js");

test("schema: scores are nullable, confidence (0-10) is required, one schema for both writers", () => {
    for (const k of ["noise_score", "lighting_score", "crowd_score"]) assert.equal(analyzeSchema.properties[k].nullable, true, k);
    assert.ok(analyzeSchema.required.includes("confidence"));
    assert.match(analyzeSchema.properties.confidence.description, /0-10/);
    assert.equal(analyzeSchema.properties.confidence.nullable, undefined);
});

test("prompt tells the model to use null instead of guessing", () => {
    const p = buildAnalysisPrompt("X", "some text");
    assert.match(p, /return null/);
    assert.match(p, /do NOT guess/);
    assert.match(p, /confidence \(0-10\)/);
    assert.match(p, /some text/);
});

test("interpretAnalysis: all null -> no_sensory_signal; some null -> incomplete; bad -> invalid; good -> write", () => {
    const nul = { noise_score: null, lighting_score: null, crowd_score: null };
    assert.deepEqual(interpretAnalysis({ ...good, ...nul }), { action: "skip", reason: "no_sensory_signal", confidence: 8 });
    assert.deepEqual(interpretAnalysis({ ...good, noise_score: null }), { action: "skip", reason: "incomplete_scores", confidence: 8 });
    assert.deepEqual(interpretAnalysis({ ...good, noise_score: "x" }), { action: "skip", reason: "invalid_scores", confidence: 8 });
    assert.equal(interpretAnalysis(good).action, "write");
});

for (const [name, run] of [["nightly cron", viaCron], ["POST /enrichment/location", viaRoute]]) {
    test(`${name}: all-null scores write no estimates but mark the place enriched`, async () => {
        const r = await run({ ...good, noise_score: null, lighting_score: null, crowd_score: null, confidence: 0 });
        assert.equal(wroteScores(r.updates), false);
        assert.equal(logs.length, 0);
        assert.equal(r.updates.length, 1);
        assert.ok(r.updates[0].lastEnrichedAt instanceof Date);   // not retried every night
        if (r.body) assert.equal(r.body.reason, "no_sensory_signal");
    });

    test(`${name}: partially null scores write no estimates (no half estimates)`, async () => {
        const r = await run({ ...good, lighting_score: null });
        assert.equal(wroteScores(r.updates), false);
        if (r.body) assert.equal(r.body.reason, "incomplete_scores");
    });
}

// ---- 3. confidence gate + enrichmentConfidence ------------------------------------------------
const { MIN_ENRICHMENT_CONFIDENCE } = await import("../src/lib/enrichmentAnalysis.js");

test("interpretAnalysis: confidence gate", () => {
    assert.equal(MIN_ENRICHMENT_CONFIDENCE, 4);
    assert.equal(interpretAnalysis({ ...good, confidence: 4 }).action, "write");       // threshold itself passes
    assert.equal(interpretAnalysis({ ...good, confidence: 10 }).action, "write");
    assert.deepEqual(interpretAnalysis({ ...good, confidence: 3.9 }), { action: "skip", reason: "low_confidence", confidence: 3.9 });
    assert.deepEqual(interpretAnalysis({ ...good, confidence: 0 }), { action: "skip", reason: "low_confidence", confidence: 0 });
    for (const bad of [undefined, null, NaN, "9", -1, 11])
        assert.deepEqual(interpretAnalysis({ ...good, confidence: bad }), { action: "skip", reason: "invalid_confidence", confidence: null }, String(bad));
});

for (const [name, run] of [["nightly cron", viaCron], ["POST /enrichment/location", viaRoute]]) {
    test(`${name}: confidence below 4 writes no estimates but records enrichmentConfidence`, async () => {
        const r = await run({ ...good, confidence: 3 });
        assert.equal(wroteScores(r.updates), false);
        assert.equal(logs.length, 0);
        assert.equal(r.updates.length, 1);
        assert.equal(r.updates[0].enrichmentConfidence, 3);
        assert.ok(r.updates[0].lastEnrichedAt instanceof Date);   // definite answer: not retried nightly
        if (r.body) { assert.equal(r.body.reason, "low_confidence"); assert.equal(r.body.confidence, 3); }
    });

    test(`${name}: missing confidence writes nothing and is not marked enriched (retried soon)`, async () => {
        const { confidence, ...noConf } = good;
        const r = await run(noConf);
        assert.equal(wroteScores(r.updates), false);
        assert.equal(r.updates.length, 0);
        if (r.body) assert.equal(r.body.reason, "invalid_confidence");
    });

    test(`${name}: an accepted result stores enrichmentConfidence with the scores`, async () => {
        const r = await run({ ...good, confidence: 6 });
        const w = r.updates.find(d => "estimatedNoiseScore" in d);
        assert.equal(w.enrichmentConfidence, 6);
        assert.equal(logs[0].scores.confidence, 6);
    });

    test(`${name}: unchanged scores still refresh enrichmentConfidence`, async () => {
        currentLocation = { ...baseLocation, lastEnrichedAt: new Date(), estimatedNoiseScore: 3, estimatedLightingScore: 2, estimatedCrowdScore: 1 };
        const r = await run({ ...good, confidence: 7 });
        assert.equal(wroteScores(r.updates), false);
        assert.equal(r.updates[0].enrichmentConfidence, 7);
    });

    test(`${name}: invalid scores with a valid confidence still record the confidence`, async () => {
        const r = await run({ ...good, noise_score: "low", confidence: 9 });
        assert.equal(wroteScores(r.updates), false);
        assert.equal(r.updates.length, 1);
        assert.equal(r.updates[0].enrichmentConfidence, 9);
        assert.equal("lastEnrichedAt" in r.updates[0], false);     // malformed output: retried soon
    });
}

// ---- 4. incomplete_scores: no estimates, marked enriched, 30-day backoff, logged -----------------
const { skipUpdateData } = await import("../src/lib/enrichmentAnalysis.js");
const { INCOMPLETE_RETRY_HOURS, STALE_THRESHOLD_HOURS, retryHoursFor, idsInIncompleteBackoff, staleWhere } = await import("../src/lib/enrichmentBackoff.js");

test("retry delay is 30 days, or the staleness window if that is longer", () => {
    assert.equal(STALE_THRESHOLD_HOURS, 168);
    assert.equal(INCOMPLETE_RETRY_HOURS, 720);
    assert.equal(retryHoursFor(168), 720);
    assert.equal(retryHoursFor(24 * 45), 24 * 45);   // a longer staleness window wins
});

test("skipUpdateData: incomplete_scores is marked enriched and stores the confidence; invalid output is not", () => {
    const inc = skipUpdateData({ reason: "incomplete_scores", confidence: 6 }, { yelpId: null, osmFacilities: null });
    assert.equal(inc.enrichmentConfidence, 6);
    assert.ok(inc.lastEnrichedAt instanceof Date);
    const invalid = skipUpdateData({ reason: "invalid_scores", confidence: 6 }, { yelpId: null, osmFacilities: null });
    assert.equal("lastEnrichedAt" in invalid, false);
});

for (const [name, run] of [["nightly cron", viaCron], ["POST /enrichment/location", viaRoute]]) {
    test(`${name}: incomplete scores -> no estimates, enrichmentConfidence stored, marked enriched, logged as incomplete_scores`, async () => {
        const r = await run({ ...good, noise_score: null, confidence: 7 });
        assert.equal(wroteScores(r.updates), false);
        assert.equal(r.updates.length, 1);
        assert.equal(r.updates[0].enrichmentConfidence, 7);
        assert.ok(r.updates[0].lastEnrichedAt instanceof Date);
        assert.equal(logs.length, 1);
        assert.equal(logs[0].locationId, "loc1");
        assert.equal(logs[0].scores.outcome, "incomplete_scores");
        assert.equal(logs[0].scores.confidence, 7);
        if (r.body) { assert.equal(r.body.reason, "incomplete_scores"); assert.equal(r.body.updated, false); }
    });

    test(`${name}: incomplete scores still save OSM facility tags`, async () => {
        osmFacilities = { seating: ["Plenty of seating"] };
        const r = await run({ ...good, crowd_score: null });
        assert.equal(wroteScores(r.updates), false);
        assert.deepEqual(r.updates[0].estimatedFacilities, osmFacilities);
        assert.equal(logs[0].scores.outcome, "incomplete_scores");
    });

    test(`${name}: other skip reasons are not logged as incomplete_scores`, async () => {
        await run({ ...good, confidence: 2 });                                       // low_confidence
        await run({ ...good, noise_score: null, lighting_score: null, crowd_score: null }); // no_sensory_signal
        await run({ ...good, noise_score: "x" });                                    // invalid_scores
        assert.equal(logs.length, 0);
    });
}

test("the backoff query looks back 30 days for incomplete_scores log rows", async () => {
    backoffRows = [{ locationId: "a" }, { locationId: "b" }, { locationId: "a" }];
    const now = Date.now();
    const ids = await idsInIncompleteBackoff(prismaMock, now);
    assert.deepEqual(ids.sort(), ["a", "b"]);
    const { where } = logFindManyArgs[0];
    assert.deepEqual(where.scores, { path: ["outcome"], equals: "incomplete_scores" });
    assert.equal(where.updatedAt.gt.getTime(), now - 30 * 24 * 3600 * 1000);
});

test("staleWhere: unchanged without backoff ids, excludes them otherwise", () => {
    const cutoff = new Date(0);
    assert.deepEqual(staleWhere(cutoff, []), { OR: [{ lastEnrichedAt: null }, { lastEnrichedAt: { lt: cutoff } }] });
    assert.deepEqual(staleWhere(cutoff, ["a"]).AND[1], { id: { notIn: ["a"] } });
});

test("nightly run skips places in backoff; a forced run ignores the backoff", async () => {
    backoffRows = [{ locationId: "loc1" }];
    geminiResponse = good;
    await runEnrichment({ force: false });
    assert.deepEqual(findManyArgs.at(-1).where.AND[1], { id: { notIn: ["loc1"] } });
    findManyArgs.length = 0; logFindManyArgs.length = 0;
    await runEnrichment({ force: true });
    assert.deepEqual(findManyArgs.at(-1).where, {});
    assert.equal(logFindManyArgs.length, 0);       // forced runs don't even look at the backoff
});

test("GET /enrichment/stale excludes places in backoff", async () => {
    backoffRows = [{ locationId: "loc1" }, { locationId: "loc2" }];
    const res = await fetch(base + "/enrichment/stale", { headers: { "x-n8n-secret": "test-secret" } });
    assert.equal(res.status, 200);
    assert.deepEqual(findManyArgs.at(-1).where.AND[1], { id: { notIn: ["loc1", "loc2"] } });
    backoffRows = [];
    await fetch(base + "/enrichment/stale", { headers: { "x-n8n-secret": "test-secret" } });
    assert.equal("AND" in findManyArgs.at(-1).where, false);
});

// ---- 5. integration with the run lock (data-freshness) ------------------------------------------------
test("runEnrichment takes the run lock, tracks the run, and finishes it as success", async () => {
    geminiResponse = good;
    const id = await runEnrichment({ force: true, trigger: "trigger-force" });
    assert.equal(id, "run1");
    assert.equal(runCreates.length, 1);
    assert.equal(runCreates[0].trigger, "trigger-force");
    assert.equal(runCreates[0].force, true);
    const final = runUpdates.at(-1);
    assert.equal(final.status, "success");
    assert.equal(final.planned, 1);
    assert.equal(final.updated, 1);
    assert.ok(runUpdates.some((u) => !("status" in u)), "a heartbeat was written before the final status");
});

test("runEnrichment uses selectLocationsToEnrich (backoff applies inside a tracked run)", async () => {
    backoffRows = [{ locationId: "loc1" }];
    geminiResponse = good;
    await runEnrichment({ force: false });
    assert.deepEqual(findManyArgs.at(-1).where.AND[1], { id: { notIn: ["loc1"] } });
    assert.equal(runCreates.length, 1);
});
