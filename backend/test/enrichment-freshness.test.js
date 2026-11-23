// !!! INTEGRATION TEST: NEEDS A THROWAWAY LOCAL POSTGRES !!!
//  - Refuses to run unless DATABASE_URL's host is localhost / 127.0.0.1.
//  - It DELETES ALL ROWS in the "EnrichmentRun" and "Location" tables before EVERY test. Never point it at a
//    database whose data you want to keep.
//  - It must NOT run in parallel with the other lock test file (enrichment-freshness.test.js and
//    enrichment-lock-extra.test.js share one database and wipe each other's rows, giving false failures).
//    Use `npm run test:db`, which sets --test-concurrency=1.
//  - The scraper, Gemini and Resend are mocked: no external or paid API is called.
//
// Run (from backend/, with the throwaway database's migrations applied):
//   export DATABASE_URL=postgresql://test@127.0.0.1:55433/freshness_test
//   npm run test:db
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(url)) {
    console.error("Refusing to run: DATABASE_URL must point at a local throwaway database.");
    process.exit(1);
}
process.env.N8N_WEBHOOK_SECRET = "test-secret";
process.env.ENRICHMENT_DELAY_MS = "0";               // no pauses between places in tests
process.env.RESEND_API_KEY = "re_test";
process.env.ADMIN_NOTIFY_EMAIL = "admin@example.test";

const sentEmails = [];
let scrapeImpl = async () => ({ combinedText: "", sources: [], yelpId: null, osmFacilities: null });

mock.module("resend", { namedExports: { Resend: class { emails = { send: async (m) => { sentEmails.push(m); return { data: { id: "x" }, error: null }; } }; } } });
mock.module("../src/services/scraper.js", { namedExports: { fetchAllSources: (...a) => scrapeImpl(...a) } });
mock.module("../src/lib/gemini.js", { namedExports: { model: { generateContent: async () => { throw new Error("gemini should not be called"); } }, embeddingModel: {} } });

const { default: prisma } = await import("../src/lib/prisma.js");
const { acquireRun, finishRun } = await import("../src/lib/enrichmentRuns.js");
const { runEnrichment } = await import("../src/lib/enrichmentCron.js");
const { catchUpEnrichment, checkEnrichmentFreshness } = await import("../src/lib/scheduler.js");
const { default: enrichmentRouter } = await import("../src/routes/enrichment.js");
const { default: express } = await import("express");

const H = 3_600_000;
const ago = (hours) => new Date(Date.now() - hours * H);
const loc = (name, lastEnrichedAt = null) => ({ name, latitude: 43.6, longitude: -79.4, lastEnrichedAt });
const run = (data) => prisma.enrichmentRun.create({ data: { trigger: "cron", ...data } });

let server, base;
before(async () => {
    const app = express();
    app.use("/enrichment", enrichmentRouter);
    server = http.createServer(app);
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await prisma.$disconnect(); });
beforeEach(async () => {
    await prisma.enrichmentRun.deleteMany();
    await prisma.location.deleteMany();
    sentEmails.length = 0;
    scrapeImpl = async () => ({ combinedText: "", sources: [], yelpId: null, osmFacilities: null });
});

test("1. concurrent acquireRun: exactly one wins, the rest get null", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => acquireRun({ trigger: "trigger" })));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await prisma.enrichmentRun.count({ where: { status: "running" } }), 1);
    // lock releases when the run finishes
    await finishRun(results.find(Boolean).id, { status: "success" });
    assert.ok(await acquireRun({ trigger: "trigger" }));
});

test("2. run with heartbeat >15min old is abandoned and the lock is released; a fresh heartbeat still blocks", async () => {
    const dead = await run({ heartbeatAt: ago(0.27) });
    const next = await acquireRun({ trigger: "cron" });
    assert.ok(next, "lock should be free after abandoning");
    const d = await prisma.enrichmentRun.findUnique({ where: { id: dead.id } });
    assert.equal(d.status, "abandoned");
    assert.ok(d.finishedAt);
    await finishRun(next.id, { status: "success" });

    const live = await run({ heartbeatAt: ago(0.08) }); // ~5 min
    assert.equal(await acquireRun({ trigger: "cron" }), null);
    assert.equal((await prisma.enrichmentRun.findUnique({ where: { id: live.id } })).status, "running");
});

test("3. every place failing => failed; partial failure => success", async () => {
    await prisma.location.createMany({ data: [loc("A"), loc("B"), loc("C")] });
    scrapeImpl = async () => { throw new Error("quota exceeded"); };
    const id = await runEnrichment({ trigger: "cron" });
    const r = await prisma.enrichmentRun.findUnique({ where: { id } });
    assert.equal(r.status, "failed");
    assert.equal(r.planned, 3); assert.equal(r.failed, 3);
    assert.equal(r.errors.items.length, 3);
    assert.match(r.errorMessage, /Every location failed/);

    let n = 0;
    scrapeImpl = async () => { if (n++ === 0) throw new Error("one bad"); return { combinedText: "", sources: [], yelpId: null, osmFacilities: null }; };
    const id2 = await runEnrichment({ trigger: "cron", force: true });
    const r2 = await prisma.enrichmentRun.findUnique({ where: { id: id2 } });
    assert.equal(r2.status, "success");
    assert.equal(r2.failed, 1);
    assert.equal(await prisma.enrichmentRun.count({ where: { status: "running" } }), 0);
});

test("4. /enrichment/freshness numbers, auth, and ?strict=true 503 after 36h", async () => {
    await prisma.location.createMany({ data: [loc("a", ago(24)), loc("b", ago(48)), loc("c", ago(24 * 10)), loc("d", null)] });
    const ok = await run({ status: "success", startedAt: ago(2.1), finishedAt: ago(2), planned: 3, updated: 2, skipped: 1 });
    await run({ status: "failed", startedAt: ago(30), finishedAt: ago(30), planned: 1, failed: 1, errorMessage: "boom" });
    const get = (path, secret = "test-secret") => fetch(base + path, { headers: secret ? { "x-n8n-secret": secret } : {} });

    assert.equal((await get("/enrichment/freshness", null)).status, 401);
    assert.equal((await get("/enrichment/freshness", "wrong")).status, 401);

    const res = await get("/enrichment/freshness?strict=true");
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.healthy, true);
    assert.equal(j.lastSuccessfulRun.id, ok.id);
    assert.ok(Math.abs(j.hoursSinceLastSuccess - 2) < 0.2);
    assert.equal(j.currentlyRunning, false);
    assert.equal(j.locations.total, 4);
    assert.equal(j.locations.enrichedLast7d, 2);
    assert.equal(j.locations.staleOver7d, 1);
    assert.equal(j.locations.neverEnriched, 1);
    assert.equal(new Date(j.locations.oldestEnrichedAt).getTime() < Date.now() - 9 * 24 * H, true);
    assert.equal(j.recentFailures.length, 1);
    assert.equal(j.recentFailures[0].errorMessage, "boom");

    await prisma.enrichmentRun.update({ where: { id: ok.id }, data: { finishedAt: ago(37) } });
    assert.equal((await get("/enrichment/freshness?strict=true")).status, 503);
    const plain = await get("/enrichment/freshness");
    assert.equal(plain.status, 200);
    assert.equal((await plain.json()).healthy, false);
});

test("4b. /enrichment/freshness lastRun shows skip reasons and Google issues (and still reads old array-shaped errors)", async () => {
    const get = (path) => fetch(base + path, { headers: { "x-n8n-secret": "test-secret" } });
    const r = await acquireRun({ trigger: "cron" });
    await finishRun(r.id, {
        status: "success", counts: { planned: 5, updated: 0, skipped: 5, failed: 0 },
        errors: [], summary: { skipReasons: { no_text: 3, low_confidence: 2 }, googleIssues: { REQUEST_DENIED: 3 } },
        errorMessage: "Google Places problems for 3 of 5 places (REQUEST_DENIED:3) - check the key, quota and billing",
    });
    const j = await (await get("/enrichment/freshness")).json();
    assert.deepEqual(j.lastRun.skipReasons, { no_text: 3, low_confidence: 2 });
    assert.deepEqual(j.lastRun.googleIssues, { REQUEST_DENIED: 3 });
    assert.deepEqual(j.lastRun.errors, []);
    assert.match(j.lastRun.errorMessage, /Google Places problems/);
    assert.equal(j.lastRun.skipped, 5);

    // a row written before this change stores a bare array: still served, with null summaries
    await prisma.enrichmentRun.deleteMany();
    await run({ status: "failed", startedAt: ago(1), finishedAt: ago(1), planned: 1, failed: 1, errors: [{ location: "A", message: "boom" }] });
    const old = (await (await get("/enrichment/freshness")).json()).lastRun;
    assert.deepEqual(old.errors, [{ location: "A", message: "boom" }]);
    assert.equal(old.skipReasons, null); assert.equal(old.googleIssues, null);
});

test("4c. health rule against real Postgres: success with updated 0 is unhealthy (strict 503), updated>0 is healthy", async () => {
    const get = (path) => fetch(base + path, { headers: { "x-n8n-secret": "test-secret" } });
    await run({ status: "success", startedAt: ago(2.1), finishedAt: ago(2), planned: 5, updated: 0, skipped: 5 });
    await run({ status: "success", startedAt: ago(1.1), finishedAt: ago(1), planned: 0 });
    let r = await get("/enrichment/freshness?strict=true");
    assert.equal(r.status, 503);
    let j = await r.json();
    assert.equal(j.healthy, false); assert.equal(j.hoursSinceLastUpdate, null); assert.equal(j.lastUpdatingRun, null);
    assert.ok(Math.abs(j.hoursSinceLastSuccess - 1) < 0.2, "hoursSinceLastSuccess kept");

    const upd = await run({ status: "success", startedAt: ago(30.1), finishedAt: ago(30), planned: 4, updated: 1, skipped: 3 });
    r = await get("/enrichment/freshness?strict=true");
    assert.equal(r.status, 200);
    j = await r.json();
    assert.equal(j.healthy, true); assert.equal(j.lastUpdatingRun.id, upd.id);
    assert.ok(Math.abs(j.hoursSinceLastUpdate - 30) < 0.2);

    await prisma.enrichmentRun.update({ where: { id: upd.id }, data: { finishedAt: ago(37) } });
    assert.equal((await get("/enrichment/freshness?strict=true")).status, 503);
});

test("5. catch-up skips when a run is active or last run started <1h ago; starts when due", async () => {
    await prisma.location.create({ data: loc("fresh", ago(1)) }); // nothing stale => catch-up run finishes instantly
    const catchups = () => prisma.enrichmentRun.count({ where: { trigger: "catchup" } });

    // (a) a run is active, last success is old
    await run({ status: "success", startedAt: ago(30), finishedAt: ago(30) });
    await run({ heartbeatAt: new Date() });
    await catchUpEnrichment();
    assert.equal(await catchups(), 0);

    // (b) no success in >26h but last run started 30 min ago (failed)
    await prisma.enrichmentRun.deleteMany();
    await run({ status: "success", startedAt: ago(30), finishedAt: ago(30) });
    await run({ status: "failed", startedAt: ago(0.5), finishedAt: ago(0.45) });
    await catchUpEnrichment();
    assert.equal(await catchups(), 0);

    // (c) recent success (10h) => not due
    await prisma.enrichmentRun.deleteMany();
    await run({ status: "success", startedAt: ago(10), finishedAt: ago(10) });
    await catchUpEnrichment();
    assert.equal(await catchups(), 0);

    // (d) success 30h ago, last run started 2h ago (failed) => starts
    await prisma.enrichmentRun.deleteMany();
    await run({ status: "success", startedAt: ago(30), finishedAt: ago(30) });
    await run({ status: "failed", startedAt: ago(2), finishedAt: ago(1.9) });
    await catchUpEnrichment();
    assert.equal(await catchups(), 1);
    assert.equal(await prisma.enrichmentRun.count({ where: { status: "running" } }), 0);
});

test("6. stale alert: emails once (mocked Resend), not again within 24h, not when healthy", async () => {
    await run({ status: "success", startedAt: ago(5), finishedAt: ago(5), planned: 3, updated: 2 });
    await checkEnrichmentFreshness();
    assert.equal(sentEmails.length, 0);

    await prisma.enrichmentRun.deleteMany();
    await run({ status: "failed", startedAt: ago(40), finishedAt: ago(40) });
    await checkEnrichmentFreshness();
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].subject, /36h/);
    await checkEnrichmentFreshness();
    assert.equal(sentEmails.length, 1);
});

test("6b. a recent success that updated nothing still alerts, and the email says how long since any place was updated", async () => {
    sentEmails.length = 0;
    // module-level dedupe from test 6 is per process, so run this check by clearing it with a fresh import
    const { checkEnrichmentFreshness: fresh } = await import("../src/lib/scheduler.js?second");
    await prisma.enrichmentRun.deleteMany();
    await run({ status: "success", startedAt: ago(50.1), finishedAt: ago(50), planned: 4, updated: 2 });
    await run({ status: "success", startedAt: ago(2.1), finishedAt: ago(2), planned: 5, updated: 0, skipped: 5 });
    await fresh();
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].text, /Last time any place was updated: 50(\.\d)?h ago/);
    assert.match(sentEmails[0].text, /finished successfully \(even if it updated nothing\): 2(\.\d)?h ago/);
    await fresh();
    assert.equal(sentEmails.length, 1, "deduped: at most one email per 24h while unhealthy");
});
