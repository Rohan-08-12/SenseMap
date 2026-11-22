// Run: node --experimental-test-module-mocks --test test/audio-and-insights-routes.test.js
// No database, no network: prisma, Cloudinary, ElevenLabs, Gemini, Claude and the scraper are mocked.
import { test, mock, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

let location = null;                       // what prisma.location.findUnique returns
const locationUpdates = [];
const tts = [];                            // scripts sent to ElevenLabs
const uploads = [];                        // Cloudinary upload options
const geminiCalls = [], claudeCalls = [], scrapeCalls = [];
let scrapeText = "";

mock.module("../src/lib/prisma.js", { defaultExport: {
    location: { findUnique: async () => location, update: async (a) => { locationUpdates.push(a); return {}; } },
} });
mock.module("../src/lib/cloudinary.js", { defaultExport: { uploader: { upload_stream: (opts, cb) => {
    uploads.push(opts);
    return { end: () => cb(null, { secure_url: `https://res.example/sensemap-audio/${opts.public_id}.mp3` }) };
} } } });
mock.module("../src/lib/elevenlabs.js", { namedExports: { generateAudioSummary: async (script) => { tts.push(script); return Buffer.from("mp3"); } } });
mock.module("../src/lib/gemini.js", { namedExports: { model: { generateContent: async () => { geminiCalls.push(1); throw new Error("must not be called"); } }, embeddingModel: {} } });
mock.module("../src/lib/anthropic.js", { namedExports: { validateWithClaude: async () => { claudeCalls.push(1); return null; } } });
mock.module("../src/lib/embeddings.js", { namedExports: { generateLocationEmbedding: async () => [] } });
mock.module("../src/services/scraper.js", { namedExports: { fetchAllSources: async () => { scrapeCalls.push(1); return { combinedText: scrapeText }; } } });
mock.module("../src/middleware/auth.js", { namedExports: { requireAuth: (req, res, next) => next() } });
mock.module("../src/middleware/syncUser.js", { namedExports: { syncUser: (req, res, next) => next() } });

const { default: express } = await import("express");
const { default: audioRouter } = await import("../src/routes/audio.js");
const { default: aiRouter } = await import("../src/routes/ai.js");
const { audioPublicId, buildAudioScript, isAudioCacheValid, AUDIO_SCRIPT_VERSION } = await import("../src/lib/audioScript.js");

let server, base;
before(async () => {
    const app = express(); app.use(express.json()); app.use("/audio", audioRouter); app.use("/ai", aiRouter);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { location = null; locationUpdates.length = 0; tts.length = 0; uploads.length = 0; geminiCalls.length = 0; claudeCalls.length = 0; scrapeCalls.length = 0; scrapeText = ""; });

const bot = { isAiGenerated: true, user: { email: "bot@sensemap.app", auth0Id: "system|sensemap-bot" } };
const visitor = { isAiGenerated: false, user: { email: "v@x.c", auth0Id: "auth0|v" } };
const loc = (over = {}) => ({
    id: "L1", name: "Tangled Art + Disability", latitude: 43.6, longitude: -79.4, category: "gallery",
    updatedAt: new Date("2026-11-01T00:00:00Z"), audioUrl: null, audioGeneratedAt: null,
    estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null,
    sensoryScores: null, reviews: [], ...over,
});
const scores = (n, l, c, count) => ({ reviewCount: count, noiseScore: n, lightingScore: l, crowdScore: c, comfortScore: 3 });
const getAudio = async (id = "L1") => { const r = await fetch(`${base}/audio/${id}`); return { status: r.status, body: await r.json() }; };

// ---- item 3: audio ---------------------------------------------------------------------------------
test("audio: a place with no scores gets 'no audio available', no fallback of 3, no ElevenLabs call", async () => {
    location = loc();                                   // nothing: category defaults
    const { status, body } = await getAudio();
    assert.equal(status, 200);
    assert.deepEqual([body.available, body.audioUrl, body.reason], [false, null, "no_scores"]);
    assert.match(body.message, /No audio is available/);
    assert.equal(tts.length, 0); assert.equal(uploads.length, 0); assert.equal(locationUpdates.length, 0);
});

test("audio: a low-confidence estimate (all 0.5) gets no audio", async () => {
    location = loc({ estimatedNoiseScore: 0.5, estimatedLightingScore: 0.5, estimatedCrowdScore: 0.5 });
    const { body } = await getAudio();
    assert.deepEqual([body.available, body.reason], [false, "low_confidence"]);
    assert.equal(tts.length, 0);
});

test("audio: reviews with no usable levels (null scores) get no audio instead of 'rated 3.0'", async () => {
    location = loc({ sensoryScores: scores(null, null, null, 1), reviews: [bot] });
    const { body } = await getAudio();
    assert.equal(body.available, false); assert.equal(tts.length, 0);
});

test("audio: an AI-estimate place is voiced from its real scores, says they are AI estimates, never 'out of 10'", async () => {
    location = loc({ estimatedNoiseScore: 1.5, estimatedLightingScore: 2.5, estimatedCrowdScore: 3.5 });
    const { body } = await getAudio();
    assert.equal(body.available, true);
    assert.equal(tts.length, 1);
    assert.match(tts[0], /AI estimates from public information/);
    assert.match(tts[0], /Noise level: very quiet\./);          // 1.5, not the old fallback 3 ("moderately quiet")
    assert.match(tts[0], /Lighting: moderate\./); assert.match(tts[0], /Crowd level: busy\./);
    assert.doesNotMatch(tts[0], /out of 10|rated|\d/);
});

test("audio: a bot-only place says it is curated; a place with a real visitor review adds no caveat", async () => {
    location = loc({ sensoryScores: scores(1.5, 1.5, 1.5, 1), reviews: [bot] });
    await getAudio();
    assert.match(tts[0], /curated from public accessibility information/);
    location = loc({ sensoryScores: scores(1.5, 1.5, 1.5, 1), reviews: [bot, visitor] });
    await getAudio();
    assert.doesNotMatch(tts[1], /curated|AI estimates/);
    assert.doesNotMatch(tts[1], /out of 10/);
});

test("audio: generated files go to a versioned id; a file from the old script is regenerated, a current one is served", async () => {
    assert.ok(AUDIO_SCRIPT_VERSION >= 2);
    const base0 = { sensoryScores: scores(2, 2, 2, 3), reviews: [visitor], updatedAt: new Date("2026-11-01T00:00:00Z"), audioGeneratedAt: new Date("2026-11-02T00:00:00Z") };

    location = loc({ ...base0, audioUrl: "https://res.example/sensemap-audio/audio_L1.mp3" });     // made by the old script
    let { body } = await getAudio();
    assert.equal(tts.length, 1, "old unversioned file is NOT served");
    assert.equal(uploads[0].public_id, audioPublicId("L1"));
    assert.match(uploads[0].public_id, /^audio_L1_v\d+$/);
    assert.match(body.audioUrl, /audio_L1_v\d+\.mp3$/);
    assert.ok(locationUpdates[0].data.audioUrl.includes(audioPublicId("L1")));

    location = loc({ ...base0, audioUrl: `https://res.example/sensemap-audio/${audioPublicId("L1")}.mp3` });   // current
    ({ body } = await getAudio());
    assert.equal(tts.length, 1, "current file is served from cache, no new ElevenLabs call");
    assert.equal(body.available, true);
});

test("audio: cache is dropped when the place was updated after the audio, and tolerates the write's few-ms skew", () => {
    const url = `https://res.example/sensemap-audio/${audioPublicId("L1")}.mp3`;
    const t = new Date("2026-11-02T00:00:00Z");
    assert.equal(isAudioCacheValid({ id: "L1", audioUrl: url, audioGeneratedAt: t, updatedAt: new Date(t.getTime() + 40) }), true, "updatedAt a few ms after = same write");
    assert.equal(isAudioCacheValid({ id: "L1", audioUrl: url, audioGeneratedAt: t, updatedAt: new Date(t.getTime() + 3600_000) }), false, "enriched an hour later");
    assert.equal(isAudioCacheValid({ id: "L1", audioUrl: null, audioGeneratedAt: t, updatedAt: t }), false);
});

test("buildAudioScript returns null when there is nothing honest to say", () => {
    assert.equal(buildAudioScript({ name: "X" }, { source: "category", noise: null, lighting: null, crowd: null }), null);
    assert.equal(buildAudioScript({ name: "X" }, { source: "estimated", noise: 0.5, lighting: 0.5, crowd: 0.5 }) === null, false, "the route, not the script, applies the low-confidence rule");
});

// ---- item 4: insights for a place with no data ---------------------------------------------------------
const postInsights = async () => { const r = await fetch(`${base}/ai/insights/L1`, { method: "POST" }); return { status: r.status, body: await r.json() }; };

test("insights: a place with no review text and no estimate returns 200 no_data and never calls Gemini, Claude or the scraper", async () => {
    location = loc({ reviews: [] });
    const { status, body } = await postInsights();
    assert.equal(status, 200);
    assert.equal(body.status, "no_data");
    assert.match(body.message, /No review or public data/);
    assert.deepEqual([geminiCalls.length, claudeCalls.length, scrapeCalls.length], [0, 0, 0]);
});

test("insights: reviews with blank text count as no data", async () => {
    location = loc({ reviews: [{ bodyText: "   ", visitTime: null }, { bodyText: null }] });
    const { body } = await postInsights();
    assert.equal(body.status, "no_data"); assert.equal(geminiCalls.length, 0);
});

test("insights: an estimated place whose live fetch finds nothing returns 200 no_data without Gemini", async () => {
    location = loc({ estimatedNoiseScore: 2, estimatedLightingScore: 2, estimatedCrowdScore: 2 });
    scrapeText = "";
    const { status, body } = await postInsights();
    assert.equal(status, 200); assert.equal(body.status, "no_data");
    assert.equal(scrapeCalls.length, 1);
    assert.equal(geminiCalls.length, 0); assert.equal(claudeCalls.length, 0);
});

test("insights: a low-confidence estimate (the slow case) skips the live source fetch entirely", async () => {
    location = loc({ estimatedNoiseScore: 0.5, estimatedLightingScore: 0.5, estimatedCrowdScore: 0.5 });
    const t0 = Date.now();
    const { status, body } = await postInsights();
    assert.equal(status, 200); assert.equal(body.status, "no_data");
    assert.equal(scrapeCalls.length, 0, "no external fetch");
    assert.ok(Date.now() - t0 < 1000);
});

test("insights: a missing place is still 404", async () => {
    location = null;
    const r = await fetch(`${base}/ai/insights/nope`, { method: "POST" });
    assert.equal(r.status, 404);
});
