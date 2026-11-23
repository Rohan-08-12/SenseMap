// Run: node --experimental-test-module-mocks --test test/missed-run-check.test.js  (no DB: prisma and the run starter are mocked)
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let lastRun = null, runningRow = null;
const started = [];
mock.module("../src/lib/prisma.js", { defaultExport: { enrichmentRun: {
    findFirst: async ({ where } = {}) => (where?.status === "running" ? runningRow : lastRun),
} } });
mock.module("../src/lib/enrichmentCron.js", { namedExports: {
    startEnrichmentCron: () => {},
    runEnrichment: async (args) => { started.push(args); return "run1"; },
} });
mock.module("../src/jobs/sendWeeklyDigest.js", { namedExports: { sendWeeklyDigest: async () => {} } });
const { missedRunDecision, missedRunCheckEnabled, checkMissedRun, nextNightlyRun, MISSED_RUN_AFTER_HOURS, MISSED_RUN_CRON } = await import("../src/lib/scheduler.js");

const H = 3_600_000, now = Date.parse("2026-11-23T15:00:00Z");
const ago = (h) => new Date(now - h * H);
const logs = [];
const orig = console.log;
beforeEach(() => { lastRun = null; runningRow = null; started.length = 0; logs.length = 0; console.log = (...a) => logs.push(a.join(" ")); });
test.afterEach(() => { console.log = orig; });

test("decision: no run ever => start", () => {
    assert.deepEqual(missedRunDecision({ activity: { lastStartedAt: null, runningHeartbeatAt: null }, now }), { action: "start", reason: "no_run", hoursSinceLastStart: null });
});

test("decision: a run started 25.9h ago (any status) => skip quietly; 26.1h ago => start", () => {
    assert.equal(MISSED_RUN_AFTER_HOURS, 26);
    const recent = missedRunDecision({ activity: { lastStartedAt: ago(25.9), runningHeartbeatAt: null }, now });
    assert.deepEqual([recent.action, recent.reason, recent.quiet], ["skip", "recent_run", true]);
    const late = missedRunDecision({ activity: { lastStartedAt: ago(26.1), runningHeartbeatAt: null }, now });
    assert.deepEqual([late.action, late.reason, late.hoursSinceLastStart], ["start", "overdue", 26.1]);
});

test("decision: a run in progress (fresh heartbeat) => skip, and say so", () => {
    const d = missedRunDecision({ activity: { lastStartedAt: ago(40), runningHeartbeatAt: ago(0.05) }, now });
    assert.deepEqual([d.action, d.reason, d.quiet], ["skip", "running", false]);
});

test("decision: a 'running' row whose heartbeat is dead (>15 min) does not block; the lock abandons it", () => {
    const d = missedRunDecision({ activity: { lastStartedAt: ago(40), runningHeartbeatAt: ago(1) }, now });
    assert.equal(d.action, "start");
});

test("decision: disabled => skip quietly even when overdue", () => {
    const d = missedRunDecision({ activity: { lastStartedAt: ago(100), runningHeartbeatAt: null }, now, enabled: false });
    assert.deepEqual([d.action, d.reason, d.quiet], ["skip", "disabled", true]);
});

test("enabled flag: on by default; off for ENRICHMENT_CATCHUP=false and for NODE_ENV=test", () => {
    assert.equal(missedRunCheckEnabled({}), true);
    assert.equal(missedRunCheckEnabled({ ENRICHMENT_CATCHUP: "true" }), true);
    assert.equal(missedRunCheckEnabled({ NODE_ENV: "production" }), true);
    assert.equal(missedRunCheckEnabled({ ENRICHMENT_CATCHUP: "false" }), false);
    assert.equal(missedRunCheckEnabled({ NODE_ENV: "test" }), false);
    assert.equal(missedRunCheckEnabled({ ENRICHMENT_CATCHUP: "false", NODE_ENV: "test" }), false);
});

test("schedule is hourly and not at minute 0", () => {
    assert.match(MISSED_RUN_CRON, /^\d+ \* \* \* \*$/);
    assert.notEqual(MISSED_RUN_CRON.split(" ")[0], "0");
});

test("checkMissedRun: overdue => one log line and one runEnrichment({ trigger: 'catchup' })", async () => {
    lastRun = { startedAt: ago(30), status: "success", trigger: "cron" };
    const d = await checkMissedRun({ now, enabled: true });
    assert.equal(d.action, "start");
    assert.deepEqual(started, [{ trigger: "catchup" }]);
    assert.equal(logs.filter((l) => l.includes("Missed-run check")).length, 1);
    assert.match(logs.find((l) => l.includes("Missed-run check")), /no run started in the last 30h.*starting a catchup run/);
});

test("checkMissedRun: a failed or skipped-everything run 3h ago counts as 'started': nothing happens, nothing is logged", async () => {
    for (const status of ["failed", "success", "abandoned"]) {
        lastRun = { startedAt: ago(3), status, trigger: "cron" };
        await checkMissedRun({ now: now + 0, enabled: true });
    }
    assert.equal(started.length, 0);
    assert.equal(logs.filter((l) => l.includes("Missed-run check")).length, 0);
});

test("checkMissedRun: running => declines with one line and starts nothing", async () => {
    lastRun = { startedAt: ago(30), status: "running", trigger: "cron" }; runningRow = { heartbeatAt: ago(0.01) };
    await checkMissedRun({ now, enabled: true });
    assert.equal(started.length, 0);
    assert.equal(logs.filter((l) => /declined — a run is already in progress/.test(l)).length, 1);
});

test("checkMissedRun: disabled => never starts", async () => {
    lastRun = { startedAt: ago(500), status: "success", trigger: "cron" };
    await checkMissedRun({ now, enabled: false });
    assert.equal(started.length, 0);
});

test("a heartbeat line appears at most once per 24h of quiet checks", async () => {
    const t0 = now + 1000 * H;           // far enough from any earlier heartbeat
    const check = async (at) => { lastRun = { startedAt: new Date(at - 3 * H), status: "success", trigger: "cron" }; await checkMissedRun({ now: at, enabled: true }); };
    await check(t0); await check(t0 + 1 * H); await check(t0 + 23 * H);
    assert.equal(logs.filter((l) => l.includes("Heartbeat")).length, 1);
    await check(t0 + 25 * H);
    assert.equal(logs.filter((l) => l.includes("Heartbeat")).length, 2);
});

test("nextNightlyRun is 04:00 Toronto: 09:00Z in winter, 08:00Z in summer, correct across the DST switch", () => {
    assert.equal(nextNightlyRun(new Date("2026-11-23T10:00:00Z")).toISOString(), "2026-11-24T09:00:00.000Z");
    assert.equal(nextNightlyRun(new Date("2026-11-23T08:59:00Z")).toISOString(), "2026-11-23T09:00:00.000Z");
    assert.equal(nextNightlyRun(new Date("2026-07-01T08:30:00Z")).toISOString(), "2026-07-02T08:00:00.000Z");
    assert.equal(nextNightlyRun(new Date("2026-03-07T12:00:00Z")).toISOString(), "2026-03-08T08:00:00.000Z");
});
