// Run: node --experimental-test-module-mocks --test test/enrichment-alert-persist.test.js  (no DB: prisma and Resend are mocked)
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.RESEND_API_KEY = "re_test";
process.env.ADMIN_NOTIFY_EMAIL = "admin@example.test";

const runs = [];
let alertRow = null;                 // the single AlertState row (key enrichment-stale)
let dbDown = { read: false, write: false, del: false };
const sent = [];
const match = (r, where = {}) => Object.entries(where).every(([k, v]) =>
    v && typeof v === "object" && "gt" in v ? r[k] > v.gt : r[k] === v);
mock.module("resend", { namedExports: { Resend: class { emails = { send: async (m) => { sent.push(m); return { data: { id: "x" }, error: null }; } }; } } });
mock.module("../src/lib/prisma.js", { defaultExport: {
    enrichmentRun: {
        findFirst: async ({ where, orderBy } = {}) => {
            const list = runs.filter((r) => match(r, where));
            const key = orderBy?.startedAt ? "startedAt" : "finishedAt";
            return list.sort((a, b) => new Date(b[key]) - new Date(a[key]))[0] ?? null;
        },
        findMany: async () => [],
        aggregate: async () => ({ _sum: { updated: 0 } }),
    },
    location: { count: async () => 0, findFirst: async () => null },
    alertState: {
        findUnique: async () => { if (dbDown.read) throw new Error("db read down"); return alertRow; },
        upsert: async ({ create, update }) => { if (dbDown.write) throw new Error("db write down"); alertRow = { ...(alertRow || create), ...update }; return alertRow; },
        deleteMany: async () => { if (dbDown.del) throw new Error("db delete down"); alertRow = null; return { count: 1 }; },
    },
} });
mock.module("../src/lib/enrichmentCron.js", { namedExports: { startEnrichmentCron: () => {}, runEnrichment: async () => "r" } });
mock.module("../src/jobs/sendWeeklyDigest.js", { namedExports: { sendWeeklyDigest: async () => {} } });
const { checkEnrichmentFreshness, _resetAlertMemory } = await import("../src/lib/scheduler.js");
const { formatHours } = await import("../src/lib/enrichmentRuns.js");
const { adminRecipient, notifyEnrichmentStale } = await import("../src/lib/notify.js");

const H = 3_600_000;
const ago = (h) => new Date(Date.now() - h * H);
const run = (o) => runs.push({ trigger: "cron", status: "success", force: false, planned: 0, updated: 0, skipped: 0, failed: 0, startedAt: ago(1), finishedAt: ago(1), errors: null, errorMessage: null, ...o });
const errs = [], warns = [];
const origErr = console.error, origWarn = console.warn;
beforeEach(() => {
    runs.length = 0; alertRow = null; sent.length = 0; errs.length = 0; warns.length = 0;
    dbDown = { read: false, write: false, del: false };
    _resetAlertMemory();
    process.env.ADMIN_NOTIFY_EMAIL = "admin@example.test";
    console.error = (...a) => errs.push(a.join(" ")); console.warn = (...a) => warns.push(a.join(" "));
});
test.afterEach(() => { console.error = origErr; console.warn = origWarn; });
const makeStale = () => run({ updated: 3, finishedAt: ago(40), startedAt: ago(40) });
const makeHealthy = () => run({ updated: 3 });

test("persistence: a restart (fresh memory) within 24h does not re-send", async () => {
    makeStale();
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    assert.ok(alertRow?.lastSentAt, "alert time stored");
    _resetAlertMemory(); // simulates a restart/deploy
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1, "no second email after restart");
});

test("persistence: re-sends once the stored time is older than 24h", async () => {
    makeStale();
    alertRow = { key: "enrichment-stale", lastSentAt: ago(25) };
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    assert.ok(Date.now() - alertRow.lastSentAt.getTime() < 60_000, "stored time refreshed");
});

test("in-memory fast path: no DB read on the second check", async () => {
    makeStale();
    await checkEnrichmentFreshness();
    dbDown.read = true; // would log an error if read again
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    assert.equal(errs.filter((e) => /stored alert time/.test(e)).length, 0);
});

test("DB read failure: falls back to in-memory dedupe, logs one line, still alerts, does not throw", async () => {
    makeStale();
    dbDown.read = true;
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    assert.equal(errs.filter((e) => /Could not read stored alert time/.test(e)).length, 1);
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1, "memory dedupe still holds");
});

test("DB write failure: logs one line, still alerts, does not throw", async () => {
    makeStale();
    dbDown.write = true;
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    assert.equal(errs.filter((e) => /Could not store alert time/.test(e)).length, 1);
});

test("healthy again: stored time is cleared so a new outage alerts immediately", async () => {
    makeStale();
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    runs.length = 0; makeHealthy();
    await checkEnrichmentFreshness();
    assert.equal(alertRow, null, "stored time reset");
    runs.length = 0; makeStale();
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 2, "new outage alerts straight away");
});

test("healthy: a failing reset is logged, not thrown", async () => {
    makeHealthy();
    dbDown.del = true;
    await checkEnrichmentFreshness();
    assert.equal(errs.filter((e) => /reset stored alert time/.test(e)).length, 1);
});

test("no runs at all: no alert and nothing stored", async () => {
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 0);
    assert.equal(alertRow, null);
});

test("wording: formatHours is 'never' without a unit for null, '36.2h' for a number", () => {
    assert.equal(formatHours(null), "never");
    assert.equal(formatHours(undefined), "never");
    assert.equal(formatHours(36.2), "36.2h");
    assert.equal(formatHours(0), "0h");
});

test("wording: log line and email when hoursSinceLastUpdate is null (never)", async () => {
    run({ updated: 0 }); // succeeded but updated nothing => no update ever
    run({ status: "failed", startedAt: ago(0.5), finishedAt: ago(0.5) });
    await checkEnrichmentFreshness();
    const line = errs.find((e) => /STALE/.test(e));
    assert.match(line, /no place updated in never \(last successful run 1h ago\)/);
    assert.doesNotMatch(line, /neverh|never h/);
    assert.match(sent[0].text, /Last time any place was updated: never\n/);
    assert.doesNotMatch(sent[0].text, /neverh|never h/);
});

test("wording: log line and email when hoursSinceLastUpdate is a number", async () => {
    run({ updated: 3, finishedAt: ago(36.2), startedAt: ago(36.2) });
    await checkEnrichmentFreshness();
    assert.match(errs.find((e) => /STALE/.test(e)), /no place updated in 36\.2h \(last successful run 36\.2h ago\)/);
    assert.match(sent[0].text, /Last time any place was updated: 36\.2h ago/);
});

test("wording: last successful run never => 'never' in the log line", async () => {
    run({ status: "failed" });
    await checkEnrichmentFreshness();
    assert.match(errs.find((e) => /STALE/.test(e)), /no place updated in never \(last successful run never\)/);
});

test("freshness output: hoursSinceLastUpdateText is 'never' or e.g. '36.2h'", async () => {
    const { getFreshness } = await import("../src/lib/enrichmentRuns.js");
    run({ updated: 0 });
    assert.equal((await getFreshness()).hoursSinceLastUpdateText, "never");
    runs.length = 0; run({ updated: 2, finishedAt: ago(36.2), startedAt: ago(36.2) });
    assert.equal((await getFreshness()).hoursSinceLastUpdateText, "36.2h");
});

// ─── Recipient safety ───────────────────────────────────────────────────────
test("recipient: exactly one 'to' equal to ADMIN_NOTIFY_EMAIL, no cc/bcc/audience/reply fields", async () => {
    await notifyEnrichmentStale({ hoursSinceLastSuccess: 40, hoursSinceLastUpdate: 40, lastRun: null });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "admin@example.test");
    assert.equal(typeof sent[0].to, "string");
    for (const f of ["cc", "bcc", "audience", "audienceId", "audience_id", "segment", "reply_to", "replyTo"]) {
        assert.ok(!(f in sent[0]), `${f} must not be present`);
    }
});

test("recipient: empty / blank / unset ADMIN_NOTIFY_EMAIL sends nothing and logs one line", async () => {
    for (const v of ["", "   ", undefined]) {
        sent.length = 0; warns.length = 0;
        if (v === undefined) delete process.env.ADMIN_NOTIFY_EMAIL; else process.env.ADMIN_NOTIFY_EMAIL = v;
        await notifyEnrichmentStale({ hoursSinceLastSuccess: 40, hoursSinceLastUpdate: 40, lastRun: null });
        assert.equal(sent.length, 0);
        assert.equal(warns.length, 1);
    }
});

test("recipient: a list of addresses is refused rather than sent to several people", () => {
    assert.equal(adminRecipient({ ADMIN_NOTIFY_EMAIL: "a@x.test, b@x.test" }), null);
    assert.equal(adminRecipient({ ADMIN_NOTIFY_EMAIL: "a@x.test;b@x.test" }), null);
    assert.equal(adminRecipient({ ADMIN_NOTIFY_EMAIL: " a@x.test " }), "a@x.test");
});

test("recipient: the watchdog never reads the subscriber table", async () => {
    // prisma mock has no emailSubscriber model; any access would throw TypeError and fail the check.
    makeStale();
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "admin@example.test");
});

// ─── Dedupe depends only on the stored alert time ───────────────────────────
// Regression for two stale emails an hour apart whose bodies differed ("last successful run 4.9h ago" vs "5.9h ago").
const T0 = Date.parse("2026-11-24T06:15:00Z");
const at = (h) => new Date(T0 + h * H);
test("dedupe: 4 checks one simulated hour apart with changing hours and run status send exactly once", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    // Last update 40h before T0; a success that updated nothing 4.9h before T0 (so "last successful run 4.9h ago", then 5.9h, ...).
    run({ updated: 3, startedAt: at(-40), finishedAt: at(-40) });
    run({ updated: 0, startedAt: at(-5), finishedAt: at(-4.9) });
    const statuses = ["failed", "success", "abandoned", "failed"]; // lastRun status changes every hour
    const seenBodies = new Set();
    for (let i = 0; i < 4; i++) {
        if (i > 0) {
            t.mock.timers.tick(H);
            run({ status: statuses[i], updated: 0, startedAt: at(i - 0.2), finishedAt: at(i - 0.1) });
        }
        await checkEnrichmentFreshness();
        if (sent[sent.length - 1]) seenBodies.add(sent[sent.length - 1].text);
    }
    assert.equal(sent.length, 1, "exactly one email over four hourly checks");
    assert.equal(seenBodies.size, 1);
    // Prove the report itself really changed between checks, so the dedupe is not passing by accident.
    const { getFreshness } = await import("../src/lib/enrichmentRuns.js");
    const now = await getFreshness();
    assert.notEqual(now.hoursSinceLastSuccess, 4.9);
    assert.equal(now.lastRun.status, "failed");
});

test("dedupe: a second send happens only after 24h", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    run({ updated: 3, startedAt: at(-40), finishedAt: at(-40) });
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    t.mock.timers.tick(23 * H + 59 * 60_000);
    run({ status: "failed", startedAt: at(23.9), finishedAt: at(23.9) });
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1, "23h59m later: still deduped");
    t.mock.timers.tick(2 * 60_000);
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 2, "just past 24h: sends again");
    t.mock.timers.tick(H);
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 2, "and the 24h window restarts");
});

test("dedupe: after a restart too, only the stored time decides (bodies differ, still one send until 24h)", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    run({ updated: 3, startedAt: at(-40), finishedAt: at(-40) });
    run({ updated: 0, startedAt: at(-5), finishedAt: at(-4.9) });
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    t.mock.timers.tick(H); _resetAlertMemory();   // redeploy an hour later: memory gone, DB row remains
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1, "the 4.9h-vs-5.9h body difference does not cause a second send");
});

test("dedupe: recovery then a new failure sends again, even inside the 24h window", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: T0 });
    run({ updated: 3, startedAt: at(-40), finishedAt: at(-40) });
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    t.mock.timers.tick(H);
    run({ updated: 5, startedAt: at(0.9), finishedAt: at(0.95) });       // a run updated places: healthy
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 1);
    runs.length = 0;
    run({ updated: 3, startedAt: at(-50), finishedAt: at(-50) });          // fails again (36h+ since an update)
    t.mock.timers.tick(H);
    await checkEnrichmentFreshness();
    assert.equal(sent.length, 2, "new outage after recovery alerts immediately");
});
