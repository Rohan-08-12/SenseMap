// Run: node --experimental-test-module-mocks --test test/enrichment-health.test.js  (no DB: prisma is mocked)
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let rows = {};   // what the mocked findFirst/findMany/count return, keyed by call order
const runs = [];
const match = (r, where = {}) => Object.entries(where).every(([k, v]) =>
    v && typeof v === "object" && "gt" in v ? r[k] > v.gt : v && typeof v === "object" && "in" in v ? v.in.includes(r[k]) : r[k] === v);
const byFinished = (a, b) => new Date(b.finishedAt) - new Date(a.finishedAt);
mock.module("../src/lib/prisma.js", { defaultExport: {
    enrichmentRun: {
        findFirst: async ({ where, orderBy } = {}) => {
            const list = runs.filter((r) => match(r, where));
            return (orderBy?.startedAt ? list.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)) : list.sort(byFinished))[0] ?? null;
        },
        findMany: async () => [],
    },
    location: { count: async () => 0, findFirst: async () => null },
} });
const { getFreshness, isHealthy, hoursSince, FRESHNESS_ALERT_HOURS } = await import("../src/lib/enrichmentRuns.js");

const H = 3_600_000;
const ago = (h) => new Date(Date.now() - h * H);
const run = (o) => runs.push({ trigger: "cron", status: "success", force: false, planned: 0, updated: 0, skipped: 0, failed: 0, startedAt: ago(1), finishedAt: ago(1), errors: null, errorMessage: null, ...o });

test("isHealthy: only a number within the threshold is healthy", () => {
    assert.equal(FRESHNESS_ALERT_HOURS, 36);
    assert.equal(isHealthy(null), false);
    assert.equal(isHealthy(0), true);
    assert.equal(isHealthy(36), true);
    assert.equal(isHealthy(36.01), false);
    assert.equal(hoursSince(null), null);
    assert.ok(Math.abs(hoursSince(ago(2)) - 2) < 0.01);
});

test("a success that updated 0 places is NOT healthy (the 5-skipped case)", async () => {
    runs.length = 0;
    run({ planned: 5, updated: 0, skipped: 5, startedAt: ago(2), finishedAt: ago(2) });
    const f = await getFreshness();
    assert.equal(f.healthy, false);
    assert.equal(f.hoursSinceLastUpdate, null);
    assert.ok(Math.abs(f.hoursSinceLastSuccess - 2) < 0.1, "hoursSinceLastSuccess is kept");
});

test("a success that updated >0 is healthy and hoursSinceLastUpdate is its age", async () => {
    runs.length = 0;
    run({ planned: 5, updated: 1, skipped: 4, startedAt: ago(3), finishedAt: ago(3) });
    const f = await getFreshness();
    assert.equal(f.healthy, true);
    assert.ok(Math.abs(f.hoursSinceLastUpdate - 3) < 0.1);
    assert.equal(f.lastUpdatingRun.updated, 1);
});

test("planned=0 runs never count as updating, even when newer than the real update", async () => {
    runs.length = 0;
    run({ planned: 4, updated: 4, startedAt: ago(40), finishedAt: ago(40) });          // last real update: 40h ago
    run({ planned: 0, updated: 0, startedAt: ago(1), finishedAt: ago(1) });            // "nothing to enrich", newer
    const f = await getFreshness();
    assert.equal(f.healthy, false, "40h > 36h; the newer empty run does not rescue it");
    assert.ok(Math.abs(f.hoursSinceLastUpdate - 40) < 0.1);
    assert.ok(Math.abs(f.hoursSinceLastSuccess - 1) < 0.1);
});

test("failed or abandoned runs with updated>0 do not count, and a running row does not", async () => {
    runs.length = 0;
    run({ status: "failed", planned: 5, updated: 3, failed: 2 });
    run({ status: "abandoned", planned: 5, updated: 2 });
    run({ status: "running", planned: 5, updated: 1, finishedAt: null });
    const f = await getFreshness();
    assert.equal(f.healthy, false); assert.equal(f.hoursSinceLastUpdate, null);
});

test("no runs at all: unhealthy, both ages null", async () => {
    runs.length = 0;
    const f = await getFreshness();
    assert.deepEqual([f.healthy, f.hoursSinceLastUpdate, f.hoursSinceLastSuccess, f.lastRun], [false, null, null, null]);
});
