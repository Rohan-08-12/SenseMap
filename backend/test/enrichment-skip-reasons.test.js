// Run: node --experimental-test-module-mocks --test test/enrichment-skip-reasons.test.js
// No database, no network: prisma, the scraper and Gemini are mocked.
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.ENRICHMENT_DELAY_MS = "0";

const runUpdates = [];
let rows = [];
let sourceFor = () => ({ combinedText: "text", googleIssue: null });   // (name) => scraper result bits
let geminiFor = () => ({ noise_score: 6, lighting_score: 4, crowd_score: 2, confidence: 8 });   // (name) => analysis
mock.module("../src/lib/prisma.js", { defaultExport: {
    location: { findMany: async () => rows, update: async () => ({}) },
    enrichmentLog: { create: async () => ({}), findMany: async () => [] },
    enrichmentRun: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }) => ({ id: "run1", force: false, ...data }),
        update: async ({ data }) => { runUpdates.push(data); return {}; },
    },
} });
mock.module("../src/services/scraper.js", { namedExports: { fetchAllSources: async ({ name }) => ({ sources: ["google"], yelpId: null, osmFacilities: null, ...sourceFor(name) }) } });
mock.module("../src/lib/gemini.js", { namedExports: { model: { generateContent: async ({ contents }) => {
    const name = contents[0].parts[0].text.match(/for "(.*?)" and extract/)?.[1] ?? contents[0].parts[0].text.match(/Analyze these reviews for "(.*?)"/)?.[1];
    return { response: { text: () => JSON.stringify({ sentiment: "neutral", tags: [], summary: "s", ...geminiFor(name) }) } };
} }, embeddingModel: {} } });

const { runEnrichment, googleIssueFlag } = await import("../src/lib/enrichmentCron.js");
const { normalizeRunErrors } = await import("../src/lib/enrichmentRuns.js");

const place = (n) => ({ id: `l${n}`, name: `P${n}`, latitude: 43.6, longitude: -79.4, category: "cafe", externalYelpId: null, googlePlaceId: `g${n}`, estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null, lastEnrichedAt: null });
beforeEach(() => { runUpdates.length = 0; rows = []; sourceFor = () => ({ combinedText: "text", googleIssue: null }); geminiFor = () => ({ noise_score: 6, lighting_score: 4, crowd_score: 2, confidence: 8 }); });

async function run() {
    const lines = []; const o = console.log, e = console.error, w = console.warn;
    console.log = (...a) => lines.push(a.join(" ")); console.error = () => {}; console.warn = () => {};
    try { await runEnrichment({ force: false, trigger: "test" }); } finally { console.log = o; console.error = e; console.warn = w; }
    return { lines, final: runUpdates.at(-1), end: lines.find((l) => l.includes(" ended ")) };
}

test("the user's case: 5 places, updated 0 / skipped 5 / failed 0, and the run now says why", async () => {
    rows = [1, 2, 3, 4, 5].map(place);
    const reasons = { P1: "no_text", P2: "no_text", P3: "no_sensory", P4: "low_conf", P5: "incomplete" };
    sourceFor = (n) => reasons[n] === "no_text" ? { combinedText: "" } : { combinedText: "text" };
    geminiFor = (n) => ({
        no_sensory: { noise_score: null, lighting_score: null, crowd_score: null, confidence: 8 },
        low_conf: { noise_score: 6, lighting_score: 4, crowd_score: 2, confidence: 2 },
        incomplete: { noise_score: 6, lighting_score: null, crowd_score: 2, confidence: 8 },
    }[reasons[n]] ?? {});
    const { final, end } = await run();
    assert.deepEqual([final.updated, final.skipped, final.failed], [0, 5, 0]);
    assert.deepEqual(final.errors.skipReasons, { no_text: 2, no_sensory_signal: 1, low_confidence: 1, incomplete_scores: 1 });
    assert.match(end, /skipped=5 failed=0 skipReasons=no_text:2,no_sensory_signal:1,low_confidence:1,incomplete_scores:1 durationSec=/);
});

test("invalid_scores is counted under its own reason", async () => {
    rows = [place(1)]; geminiFor = () => ({ noise_score: 99, lighting_score: 4, crowd_score: 2, confidence: 8 });
    const { final } = await run();
    assert.deepEqual(final.errors.skipReasons, { invalid_scores: 1 });
});

test("no text because Google failed is reported as google_error and in googleIssues, not as a quiet place", async () => {
    rows = [1, 2].map(place);
    sourceFor = (n) => n === "P1" ? { combinedText: "", googleIssue: "REQUEST_DENIED" } : { combinedText: "" };
    const { final, end } = await run();
    assert.deepEqual(final.errors.skipReasons, { google_error: 1, no_text: 1 });
    assert.deepEqual(final.errors.googleIssues, { REQUEST_DENIED: 1 });
    assert.match(end, /googleIssues=REQUEST_DENIED:1/);
});

test("many Google denials flag the run in errorMessage (status stays success: other places worked)", async () => {
    rows = [1, 2, 3, 4, 5].map(place);
    sourceFor = (n) => ["P1", "P2", "P3"].includes(n) ? { combinedText: "text from yelp", googleIssue: "REQUEST_DENIED" } : { combinedText: "text" };
    const { final, end } = await run();
    assert.equal(final.status, "success"); assert.equal(final.updated, 5);
    assert.match(final.errorMessage, /Google Places problems for 3 of 5 places \(REQUEST_DENIED:3\)/);
    assert.match(end, /note="Google Places problems/);
});

test("googleIssueFlag thresholds: needs min(3, processed) issues and at least half the places", () => {
    assert.equal(googleIssueFlag({}, 10), undefined);
    assert.equal(googleIssueFlag({ OVER_QUERY_LIMIT: 2 }, 10), undefined, "2 of 10");
    assert.equal(googleIssueFlag({ OVER_QUERY_LIMIT: 3 }, 10), undefined, "3 of 10 is under half");
    assert.match(googleIssueFlag({ REQUEST_DENIED: 5, http_500: 1 }, 10), /6 of 10 places \(REQUEST_DENIED:5,http_500:1\)/);
    assert.match(googleIssueFlag({ REQUEST_DENIED: 1 }, 1), /1 of 1/, "a single-place run where Google failed");
});

test("a clean run records empty summaries and its end line has no skip/google fields", async () => {
    rows = [1, 2].map(place);
    const { final, end } = await run();
    assert.deepEqual(final.errors, { items: [], skipReasons: {}, googleIssues: {} });
    assert.doesNotMatch(end, /skipReasons|googleIssues/);
    assert.equal(final.errorMessage, null);
});

test("normalizeRunErrors reads both the old array and the new object", () => {
    assert.deepEqual(normalizeRunErrors([{ location: "A", message: "x" }]), { items: [{ location: "A", message: "x" }], skipReasons: null, googleIssues: null });
    assert.deepEqual(normalizeRunErrors({ items: [], skipReasons: { no_text: 2 }, googleIssues: {} }).skipReasons, { no_text: 2 });
    assert.deepEqual(normalizeRunErrors(null), { items: [], skipReasons: null, googleIssues: null });
});
