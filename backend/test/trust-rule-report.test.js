// Run: node --experimental-test-module-mocks --test test/trust-rule-report.test.js  (no DB)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertLocalDb, bucket, wasRankedBefore, showedNumbersInSearchBefore, report } from "../scripts/trust_rule_report.js";

const base = { estimatedNoiseScore: null, estimatedLightingScore: null, estimatedCrowdScore: null, enrichmentConfidence: null, sensoryScores: null };
const osm = { ...base, name: "Cafe", sensoryScores: { reviewCount: 0, noiseScore: 3, lightingScore: 3.5, crowdScore: 3, comfortScore: 2.8 } };
const gore = { ...base, name: "The Gore", estimatedNoiseScore: 0.5, estimatedLightingScore: 0.5, estimatedCrowdScore: 0.5 };
const reviewed = { ...base, name: "Reviewed", sensoryScores: { reviewCount: 2, noiseScore: 2, lightingScore: 3, crowdScore: 2, comfortScore: 4 } };
const none = { ...base, name: "Pilot" };

test("it contains no code that writes", () => {
    const src = fs.readFileSync(new URL("../scripts/trust_rule_report.js", import.meta.url), "utf8").split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(src, /\.(delete|deleteMany|update|updateMany|create|createMany|upsert|\$executeRaw|\$queryRaw)\b/);
});

test("refuses a non-local database unless --allow-remote-db", () => {
    assert.throws(() => assertLocalDb("postgresql://u:p@db.x.supabase.co/postgres"), /Refusing to run/);
    assert.doesNotThrow(() => assertLocalDb("postgresql://u@127.0.0.1:5432/x"));
    assert.doesNotThrow(() => assertLocalDb("postgresql://u@db.x.supabase.co/x", { allowRemote: true }));
});

test("buckets and the old behaviour: category defaults and all-floor estimates were ranked before and are not now", () => {
    assert.equal(bucket(osm), "category default scores only (reviewCount 0)");
    assert.equal(bucket(gore), "AI estimate, all at the 0.5 floor");
    assert.equal(bucket(reviewed), "community (trusted)");
    assert.equal(bucket(none), "no scores at all");
    assert.deepEqual([osm, gore, reviewed, none].map(wasRankedBefore), [true, true, true, false]);
    assert.deepEqual([osm, gore, reviewed, none].map(showedNumbersInSearchBefore), [true, true, true, false]);
});

test("report counts what changes", async () => {
    const prisma = { location: { findMany: async () => [osm, gore, reviewed, none] } };
    const out = [];
    const r = await report(prisma, { log: (...a) => out.push(a.join(" ")) });
    assert.deepEqual([r.total, r.trusted, r.removedFromRankings, r.noLongerShownInSearch], [4, 1, 2, 2]);
    assert.match(out.join("\n"), /The Gore/);
});
