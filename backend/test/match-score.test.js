// Run: node --test test/match-score.test.js   (no database needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMatch, factorMatch, compareMatches } from "../src/lib/matchScore.js";

// Previous behaviour, kept here only to show before/after.
const oldFactor = (score, tol) => Math.max(0, 100 - Math.abs(score - tol) * 25);

const est = (n, l, c) => ({ sensoryScores: null, estimatedNoiseScore: n, estimatedLightingScore: l, estimatedCrowdScore: c });
const tol = (n, l = n, c = n) => ({ noiseTolerance: n, lightingTolerance: l, crowdTolerance: c });

test("before/after for the three agreed cases", () => {
    const cases = [
        ["place 0.5 vs tolerance 3", 0.5, 3, 38, 100],
        ["place 4 vs tolerance 2",   4,   2, 50, 50],
        ["place == tolerance (3)",   3,   3, 100, 100],
    ];
    for (const [name, score, t, wasPct, nowPct] of cases) {
        const before = Math.round(oldFactor(score, t)), after = Math.round(factorMatch(score, t));
        console.log(`${name.padEnd(26)} before ${before}%  after ${after}%`);
        assert.equal(before, wasPct); assert.equal(after, nowPct);
        // full location (spread kept >= 0.25 so it isn't flagged low-confidence): same result as the single factor
        assert.equal(computeMatch(est(score, score + 0.3, score - 0.3 < 0.5 ? score : score - 0.3), tol(t, t + 5, t + 5)).matchScore, Math.round((factorMatch(score, t) + 100 + 100) / 3));
    }
});

test("floor at 0 and ceiling at 100", () => {
    assert.equal(factorMatch(5, 1), 0);   // 4 over * 25 = 100 -> 0
    assert.equal(factorMatch(5, 0), 0);
    assert.equal(factorMatch(1, 5), 100);
});

test("calm estimate with real spread (0.5/1.5/1) vs tolerances 2/2/2 is now 100, not the old 75", () => {
    assert.equal(computeMatch(est(0.5, 1.5, 1), tol(2)).matchScore, 100);
    assert.equal(Math.round((oldFactor(0.5, 2) + oldFactor(1.5, 2) + oldFactor(1, 2)) / 3), 75);
});

test("1-4 reviews use the 70/30 community/estimate blend (same as the panel)", () => {
    const loc = { sensoryScores: { reviewCount: 2, noiseScore: 4, lightingScore: 4, crowdScore: 4, comfortScore: 2 },
                  estimatedNoiseScore: 1, estimatedLightingScore: 1, estimatedCrowdScore: 1 };
    const m = computeMatch(loc, tol(3));
    assert.ok(Math.abs(m.noise - (4 * 0.7 + 1 * 0.3)) < 1e-9);          // 3.1
    assert.equal(m.matchScore, Math.round(100 - 0.1 * 25));              // 98
    assert.equal(m.source, "community");
});

test("5+ reviews use community scores only; no data returns null", () => {
    const loc = { sensoryScores: { reviewCount: 6, noiseScore: 4, lightingScore: 2, crowdScore: 3, comfortScore: 3 },
                  estimatedNoiseScore: 1, estimatedLightingScore: 1, estimatedCrowdScore: 1 };
    assert.equal(computeMatch(loc, tol(3)).noise, 4);
    assert.equal(computeMatch({ sensoryScores: null, estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null }, tol(3)), null);
});

test("a blank community factor falls back instead of producing NaN", () => {
    const loc = { sensoryScores: { reviewCount: 1, noiseScore: null, lightingScore: 3, crowdScore: 3, comfortScore: 3 },
                  estimatedNoiseScore: 2, estimatedLightingScore: 2, estimatedCrowdScore: 2 };
    const m = computeMatch(loc, tol(3));
    assert.ok(Number.isFinite(m.matchScore));
});

test("sample ordering, old vs new (user tolerances 2/2/2)", () => {
    const none = { estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null };
    const sample = {
        "Quiet library (8 rev 1.5/2/1.5)": { ...none, sensoryScores: { reviewCount: 8, noiseScore: 1.5, lightingScore: 2, crowdScore: 1.5, comfortScore: 4 } },
        "Busy mall (6 rev 4/4/4.5)":       { ...none, sensoryScores: { reviewCount: 6, noiseScore: 4, lightingScore: 4, crowdScore: 4.5, comfortScore: 1.5 } },
        "Cafe (est 2/2.4/2)":              est(2, 2.4, 2),
        "Park (est 1/1.5/1)":              est(1, 1.5, 1),
        "Pub (est 4/3/4)":                 est(4, 3, 4),
        "The Gore (est 0.5/0.5/0.5)":      est(0.5, 0.5, 0.5),
    };
    const oldMatch = (l) => {
        const e = l.sensoryScores?.reviewCount > 0
            ? l.sensoryScores
            : { noiseScore: l.estimatedNoiseScore, lightingScore: l.estimatedLightingScore, crowdScore: l.estimatedCrowdScore };
        return Math.round((oldFactor(e.noiseScore, 2) + oldFactor(e.lightingScore, 2) + oldFactor(e.crowdScore, 2)) / 3);
    };
    const rows = Object.entries(sample).map(([name, l]) => {
        const m = computeMatch(l, tol(2));
        return { name, old: oldMatch(l), now: m.matchScore, matchScore: m.matchScore, source: m.source, noiseScore: m.noise, lightingScore: m.lighting, crowdScore: m.crowd };
    });
    console.log("OLD order:", [...rows].sort((a, b) => b.old - a.old).map(r => `${r.name} ${r.old}%`).join(" > "));
    console.log("NEW order:", [...rows].sort(compareMatches).map(r => `${r.name} ${r.now}%`).join(" > "));
    const gore = rows.find(r => r.name.startsWith("The Gore"));
    assert.equal(gore.now, null);                       // low-confidence: no percentage
    assert.equal([...rows].sort(compareMatches).at(-1).name, gore.name); // and it sorts last
});

test("ties at 100% break toward community data, then lower load", () => {
    const rows = [
        { name: "est calm",  matchScore: 100, source: "estimated", noiseScore: 1, lightingScore: 1, crowdScore: 1 },
        { name: "est mid",   matchScore: 100, source: "estimated", noiseScore: 2, lightingScore: 2, crowdScore: 2 },
        { name: "community", matchScore: 100, source: "community", noiseScore: 2, lightingScore: 2, crowdScore: 2 },
        { name: "worse",     matchScore: 90,  source: "community", noiseScore: 1, lightingScore: 1, crowdScore: 1 },
    ].sort(compareMatches).map(r => r.name);
    assert.deepEqual(rows, ["community", "est calm", "est mid", "worse"]);
});

test("low-confidence estimates get no match %, sort last, and never become best match", async () => {
    const { isLowConfidence } = await import("../src/lib/scores.js");
    assert.equal(computeMatch(est(0.5, 0.5, 0.5), tol(2)).matchScore, null);
    assert.equal(computeMatch(est(0.5, 0.5, 0.5), tol(2)).lowConfidence, true);
    assert.equal(computeMatch(est(3, 3.1, 3), tol(2)).lowConfidence, true);   // spread < 0.25
    assert.equal(computeMatch(est(1, 2, 3), tol(3)).lowConfidence, false);
    // community data is never low confidence, even when flat
    const flat = { sensoryScores: { reviewCount: 6, noiseScore: 0.5, lightingScore: 0.5, crowdScore: 0.5, comfortScore: 5 }, estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null };
    assert.equal(computeMatch(flat, tol(2)).lowConfidence, false);
    assert.equal(isLowConfidence({ source: "estimated", noise: 2, lighting: 4, crowd: 1 }), false);
    const sorted = [computeMatch(est(0.5, 0.5, 0.5), tol(2)), computeMatch(est(4, 4, 4.5), tol(2))]
        .map((m, i) => ({ i, ...m })).sort(compareMatches);
    assert.deepEqual(sorted.map(r => r.i), [1, 0]);
});
