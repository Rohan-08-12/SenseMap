// Run: node --experimental-test-module-mocks --test test/insight-confidence.test.js  (no DB, no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInsightConfidence, isLowInsightConfidence, MIN_INSIGHT_CONFIDENCE, LOW_CONFIDENCE_NOTE } from "../src/lib/insightConfidence.js";

const insight = (confidence) => ({
    confidence,
    noise: { score: 3, summary: "Moderate noise." }, lighting: { score: 3.5, summary: "Moderately bright." },
    crowd: { score: 2, summary: "Few people." }, bestTime: "Weekday mornings", sentiment: "neutral",
    tags: ["Quiet"], preparationGuide: ["Bring headphones"],
});

test("threshold is the same 4/10 used for enrichment, on a 0-100 scale", () => {
    assert.equal(MIN_INSIGHT_CONFIDENCE, 40);
});

test("35% confidence (the YSM Evergreen case): summaries, scores, best time, tags and tips are hidden", () => {
    const r = applyInsightConfidence(insight(35));
    assert.equal(r.lowConfidence, true);
    assert.equal(r.lowConfidenceNote, LOW_CONFIDENCE_NOTE);
    for (const k of ["noise", "lighting", "crowd"]) { assert.equal(r[k].summary, null); assert.equal(r[k].score, null); }
    assert.equal(r.bestTime, ""); assert.deepEqual(r.tags, []); assert.deepEqual(r.preparationGuide, []);
    assert.equal(r.confidence, 35);   // the number itself is still shown
});

test("40 and above is shown unchanged", () => {
    for (const c of [40, 62, 90]) {
        const input = insight(c), r = applyInsightConfidence(input);
        assert.equal(r.lowConfidence, false);
        assert.equal(r.noise.summary, "Moderate noise."); assert.deepEqual(r.tags, ["Quiet"]);
    }
});

test("missing or invalid confidence counts as low", () => {
    for (const c of [undefined, null, NaN, "80", -5]) assert.equal(isLowInsightConfidence(c), true, String(c));
    assert.equal(applyInsightConfidence(insight(undefined)).lowConfidence, true);
});

test("does not mutate its input", () => {
    const input = insight(10); applyInsightConfidence(input);
    assert.equal(input.noise.summary, "Moderate noise.");
});
