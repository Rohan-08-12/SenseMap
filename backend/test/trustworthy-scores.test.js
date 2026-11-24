// Run: node --experimental-test-module-mocks --test test/trustworthy-scores.test.js  (no DB: prisma is mocked)
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

const locations = [];
mock.module("../src/lib/prisma.js", { defaultExport: {
    location: { findMany: async () => locations, findUnique: async ({ where }) => locations.find((l) => l.id === where.id) ?? null },
    review: { findMany: async () => [] },
} });
mock.module("../src/middleware/auth.js", { namedExports: { requireAuth: (q, r, n) => n() } });
mock.module("../src/middleware/syncUser.js", { namedExports: { syncUser: (q, r, n) => n() } });
mock.module("../src/lib/embeddings.js", { namedExports: { cosineSimilarity: () => 0, generateLocationEmbedding: async () => [] } });

const { hasTrustworthyScores, MIN_SCORE, MIN_ENRICHMENT_CONFIDENCE } = await import("../src/lib/trustworthyScores.js");
const frontend = await import("../../frontend/src/trustworthyScores.js");
const { isLowConfidence } = await import("../src/lib/scores.js");
const { toGeoJSON } = await import("../src/lib/geojson.js");
const { computeMatch } = await import("../src/lib/matchScore.js");
const { default: express } = await import("express");
const { default: rankingsRouter } = await import("../src/routes/rankings.js");
const { default: locationsRouter } = await import("../src/routes/locations.js");

const d = (noise, lighting, crowd, source) => ({ noise, lighting, crowd, source });

test("rule: real community or estimated numbers pass", () => {
    assert.equal(hasTrustworthyScores(d(2, 3, 2, "community")), true);
    assert.equal(hasTrustworthyScores(d(2, 2.5, 2, "estimated")), true);
    assert.equal(hasTrustworthyScores(d(2, 2, 2, "estimated")), true, "a flat but real estimate is fine");
    assert.equal(hasTrustworthyScores(d(0.5, 4.5, 5, "community")), true, "0.5 and 5 are real, in-range values");
});

test("rule: missing is never a number. null, undefined, NaN and 0 all fail, in every position", () => {
    for (const bad of [null, undefined, NaN, 0, -1, 5.1, "3"]) {
        for (let i = 0; i < 3; i++) {
            const v = [3, 3, 3]; v[i] = bad;
            assert.equal(hasTrustworthyScores(d(...v, "community")), false, `${String(bad)} at ${i}`);
        }
    }
    assert.equal(hasTrustworthyScores(null), false);
    assert.equal(hasTrustworthyScores(undefined), false);
    assert.equal(hasTrustworthyScores({}), false);
});

test("rule: the all-floor AI placeholder (0.5/0.5/0.5) fails, but only when estimated; 0.5/0.5/1 passes", () => {
    assert.equal(hasTrustworthyScores(d(0.5, 0.5, 0.5, "estimated")), false);
    assert.equal(hasTrustworthyScores(d(0.5, 0.5, 1, "estimated")), true);
    assert.equal(hasTrustworthyScores(d(0.5, 0.5, 0.5, "community")), true, "a visitor really can report all-minimum");
});

test("rule: category placeholders (OSM static defaults) and unknown sources fail", () => {
    assert.equal(hasTrustworthyScores(d(3, 3.5, 3, "category")), false);
    assert.equal(hasTrustworthyScores(d(3, 3.5, 3, undefined)), false);
    assert.equal(hasTrustworthyScores(d(3, 3.5, 3, "something-else")), false);
});

test("rule: recorded enrichment confidence must be >= 4 for estimates; unknown (null) is allowed; it never affects community", () => {
    assert.equal(MIN_ENRICHMENT_CONFIDENCE, 4);
    assert.equal(hasTrustworthyScores(d(2, 2.5, 2, "estimated"), 3.9), false);
    assert.equal(hasTrustworthyScores(d(2, 2.5, 2, "estimated"), 4), true);
    assert.equal(hasTrustworthyScores(d(2, 2.5, 2, "estimated"), null), true);
    assert.equal(hasTrustworthyScores(d(2, 3, 2, "community"), 1), true);
});

test("the old all-floor check is a subset of the new rule", () => {
    for (const v of [[0.5, 0.5, 0.5], [0.5, 0.5, 1], [2, 2, 2]]) {
        const disp = d(...v, "estimated");
        if (isLowConfidence(disp)) assert.equal(hasTrustworthyScores(disp), false);
    }
});

test("the frontend copy is byte-for-byte the backend file, and gives the same answers", () => {
    const a = fs.readFileSync(new URL("../src/lib/trustworthyScores.js", import.meta.url), "utf8");
    const b = fs.readFileSync(new URL("../../frontend/src/trustworthyScores.js", import.meta.url), "utf8");
    assert.equal(b, a, "frontend/src/trustworthyScores.js must be an exact copy of backend/src/lib/trustworthyScores.js");
    for (const x of [d(2, 3, 2, "community"), d(0.5, 0.5, 0.5, "estimated"), d(3, 3, 3, "category"), d(null, 3, 3, "community"), d(2, 2, 2, "estimated")]) {
        for (const c of [null, 3, 4]) assert.equal(frontend.hasTrustworthyScores(x, c), hasTrustworthyScores(x, c));
    }
    assert.equal(frontend.MIN_SCORE, MIN_SCORE);
});

// ─── The same rule at every endpoint ─────────────────────────────────────────
const base = { address: null, category: "cafe", latitude: 43.65, longitude: -79.38, imageUrl: null, dataSource: "category", estimatedFacilities: null, reviews: [],
    estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null, enrichmentConfidence: null, sensoryScores: null };
const community = { ...base, id: "A", name: "Community Cafe", address: "1 Queen St", sensoryScores: { reviewCount: 3, noiseScore: 2, lightingScore: 3, crowdScore: 2, comfortScore: 4.2 } };
const goreFloor = { ...base, id: "B", name: "The Gore", estimatedNoiseScore: 0.5, estimatedLightingScore: 0.5, estimatedCrowdScore: 0.5, dataSource: "toronto" };
const osmDefault = { ...base, id: "C", name: "Sam James Coffee Bar", sensoryScores: { reviewCount: 0, noiseScore: 3, lightingScore: 3.5, crowdScore: 3, comfortScore: 2.8 } };
const noData = { ...base, id: "D", name: "Pilot Coffee Roasters" };
const estimate = { ...base, id: "E", name: "AI Estimate Park", estimatedNoiseScore: 2, estimatedLightingScore: 2.5, estimatedCrowdScore: 2, enrichmentConfidence: 7, dataSource: "google" };
const lowConf = { ...base, id: "F", name: "Unsure Place", estimatedNoiseScore: 2, estimatedLightingScore: 2, estimatedCrowdScore: 2, enrichmentConfidence: 3 };
const all = [community, goreFloor, osmDefault, noData, estimate, lowConf];

let server, url;
before(async () => {
    const app = express();
    app.use("/rankings", rankingsRouter); app.use("/locations", locationsRouter);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${server.address().port}`;
    locations.push(...all);
});
after(() => server.close());
const get = async (p) => (await fetch(url + p)).json();

test("/rankings lists only trustworthy places: no 0.5/0.5/0.5 at 5.5, no category defaults, no unscored places", async () => {
    const r = await get("/rankings");
    assert.deepEqual(r.map((x) => x.locationId), ["A", "E"]);
    assert.ok(r.every((x) => x.noiseScore >= 0.5 && x.comfortScore <= 6));
    assert.ok(!r.some((x) => x.name === "The Gore"));
});

test("/locations/heatmap draws only trustworthy places", async () => {
    const r = await get("/locations/heatmap");
    assert.deepEqual(r.map((x) => x.locationId).sort(), ["A", "E"]);
});

test("search/list GeoJSON: untrusted places get null scores (never 0) and trustworthy:false; trusted keep numbers; address is included", async () => {
    const fc = toGeoJSON(all);
    const by = Object.fromEntries(fc.features.map((f) => [f.properties.id, f.properties]));
    for (const id of ["B", "C", "D", "F"]) {
        assert.equal(by[id].trustworthy, false, id);
        assert.deepEqual([by[id].noiseScore, by[id].lightingScore, by[id].crowdScore, by[id].comfortScore], [null, null, null, null], id);
    }
    assert.equal(by.A.trustworthy, true);
    assert.deepEqual([by.A.noiseScore, by.A.lightingScore, by.A.crowdScore], [2, 3, 2]);
    assert.equal(by.E.trustworthy, true);
    assert.ok(by.E.comfortScore > 1 && by.E.comfortScore < 6);
    assert.equal(by.A.address, "1 Queen St");
    assert.equal(by.D.address, null);
});

test("the place panel (GET /locations/:id) agrees: trustworthy true/false, with lowConfidence mirroring it", async () => {
    for (const [id, expected] of [["A", true], ["B", false], ["C", false], ["D", false], ["E", true], ["F", false]]) {
        const r = await get(`/locations/${id}`);
        assert.equal(r.displayScores.trustworthy, expected, id);
        assert.equal(r.displayScores.lowConfidence, !expected, id);
    }
});

test("match %: no percentage for anything that is not trustworthy, and a number for what is", () => {
    for (const loc of [goreFloor, osmDefault, lowConf]) assert.equal(computeMatch(loc)?.matchScore ?? null, null, loc.name);
    assert.equal(typeof computeMatch(community).matchScore, "number");
    assert.equal(typeof computeMatch(estimate).matchScore, "number");
});
