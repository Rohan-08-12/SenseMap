// Run: node --test test/curated-labels-radar.test.js  (pure helpers, no DB, no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeEvidence, radarValues, factorShares } from "../../frontend/src/panelLabels.js";
import { summarizeReviewSources } from "../src/lib/systemBot.js";

const bot = { isAiGenerated: true, user: { email: "bot@sensemap.app", auth0Id: "system|sensemap-bot" } };
const real = { isAiGenerated: false, user: { email: "a@b.c", auth0Id: "auth0|1" } };

test("summarizeReviewSources separates bot (by flag or by bot user) from real reviews", () => {
    assert.deepEqual(summarizeReviewSources([bot]), { total: 1, real: 0, bot: 1 });
    assert.deepEqual(summarizeReviewSources([bot, real, { ...real, isAiGenerated: true }]), { total: 3, real: 1, bot: 2 });
    assert.deepEqual(summarizeReviewSources([]), { total: 0, real: 0, bot: 0 });
});

test("Tangled Art + Disability case: one bot-only review never says 'community reviews'", () => {
    const e = describeEvidence({ dataSource: "community", reviewSources: { total: 1, real: 0, bot: 1 }, dataSourceField: "google" });
    assert.equal(e.hasRealReviews, false);
    for (const text of [e.trend, e.insight, e.countLabel]) assert.doesNotMatch(text, /community reviews|1 reviews/);
    assert.match(e.trend, /curated from public accessibility information/);
    assert.match(e.insight, /curated from public accessibility information/);
    assert.equal(e.countLabel, "Curated");
});

test("real visitor reviews keep the 'community reviews' wording, with correct pluralisation", () => {
    const one = describeEvidence({ dataSource: "community", reviewSources: { total: 2, real: 1, bot: 1 } });
    assert.equal(one.hasRealReviews, true);
    assert.match(one.trend, /community reviews/); assert.match(one.insight, /community reviews/);
    assert.equal(one.countLabel, "1 review");
    assert.equal(describeEvidence({ dataSource: "community", reviewSources: { total: 4, real: 4, bot: 0 } }).countLabel, "4 reviews");
});

test("falls back to the review list's isBot flags when reviewSources is missing", () => {
    assert.equal(describeEvidence({ dataSource: "community", reviews: [{ isBot: true }] }).hasRealReviews, false);
    assert.equal(describeEvidence({ dataSource: "community", reviews: [{ isBot: true }, { isBot: false }] }).hasRealReviews, true);
});

test("estimated places use their real dataSource wording; category has no trend/insight wording", () => {
    const e = describeEvidence({ dataSource: "estimated", dataSourceField: "google,osm" });
    assert.match(e.trend, /Google Places and OpenStreetMap tags/); assert.doesNotMatch(e.trend + e.insight, /community/);
    assert.equal(e.countLabel, "AI estimate");
    const c = describeEvidence({ dataSource: "category" });
    assert.equal(c.trend, ""); assert.equal(c.insight, "");
});

test("radar shows the same 0-5 values as the weights card, rounded to one decimal (not 10-point integers)", () => {
    const sensory = { noise: 2.6, lighting: 2.96, crowd: 1.04, comfort: 3.449 };
    const r = radarValues(sensory);
    assert.deepEqual(r, { noise: 2.6, lighting: 3, crowd: 1, comfort: 3.4 });
    // old behaviour for contrast: (2.6 * 2).toFixed(0) === "5" on a different scale from the weights card
    assert.equal((2.6 * 2).toFixed(0), "5");
    // the weights card derives its shares from the SAME underlying scores
    const shares = factorShares({ noise: sensory.noise, lighting: sensory.lighting, crowd: sensory.crowd });
    assert.equal(shares.lighting, Math.round(sensory.lighting / (sensory.noise + sensory.lighting + sensory.crowd) * 100));
    // ordering agrees: the factor with the biggest share has the biggest radar value
    const top = Object.entries(r).filter(([k]) => k !== "comfort").sort((a, b) => b[1] - a[1])[0][0];
    assert.equal(shares.dominant, top);
});

test("radarValues survives missing numbers", () => {
    assert.deepEqual(radarValues({ noise: null, lighting: undefined, crowd: NaN, comfort: 5 }), { noise: 0, lighting: 0, crowd: 0, comfort: 5 });
});
