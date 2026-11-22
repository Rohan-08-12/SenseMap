// Run: node --test test/dry-run-stats.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, median, histogram, summarizeAnalyses } from "../src/lib/dryRunStats.js";
import { interpretAnalysis } from "../src/lib/enrichmentAnalysis.js";

const row = (analysis) => ({ analysis, decision: interpretAnalysis(analysis) });
const A = (n, l, c, conf) => ({ noise_score: n, lighting_score: l, crowd_score: c, confidence: conf });

test("redact removes secrets wherever they appear, ignores empty/short values", () => {
    assert.equal(redact("GET https://x/y?key=SECRETKEY123 failed; SECRETKEY123", ["SECRETKEY123"]), "GET https://x/y?key=*** failed; ***");
    assert.equal(redact("abc", [undefined, "", "ab"]), "abc");
});

test("median and histogram", () => {
    assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null);
    const h = histogram([0, 0.4, 3, 3.9, 10], 10);
    assert.equal(h[0], 2); assert.equal(h[3], 2); assert.equal(h[10], 1); assert.equal(Object.keys(h).length, 11);
});

test("summary: null rate, reasons, confidence distribution", () => {
    const rows = [
        row(A(6, 4, 2, 8)),              // written
        row(A(null, null, null, 0)),     // no_sensory_signal
        row(A(3, null, 2, 7)),           // incomplete
        row(A(5, 5, 5, 3)),              // low_confidence
        row(A(5, 5, 5, undefined)),      // invalid_confidence
        { analysis: null, decision: null }, // failed call
    ];
    const s = summarizeAnalyses(rows, 4);
    assert.equal(s.places, 6); assert.equal(s.failedCalls, 1);
    assert.deepEqual(s.nullRatePerFactor, { noise_score: 1 / 5, lighting_score: 2 / 5, crowd_score: 1 / 5 });
    assert.equal(s.overallNullRate, 4 / 15);
    assert.deepEqual(s.reasons, { written: 1, no_sensory_signal: 1, incomplete_scores: 1, low_confidence: 1, invalid_confidence: 1 });
    assert.equal(s.wouldWrite, 1);
    assert.equal(s.confidence.n, 4); assert.equal(s.confidence.missingOrInvalid, 1);
    assert.equal(s.confidence.belowThreshold, 2);   // 0 and 3
    assert.equal(s.confidence.median, 5);
    assert.equal(s.confidence.histogram[8], 1);
});
