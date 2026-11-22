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
import { execFileSync } from "node:child_process";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(url)) {
    console.error("Refusing to run: DATABASE_URL must point at a local throwaway database.");
    process.exit(1);
}
process.env.N8N_WEBHOOK_SECRET = "test-secret";
process.env.ENRICHMENT_DELAY_MS = "0";               // no pauses between places in tests

mock.module("resend", { namedExports: { Resend: class { emails = { send: async () => ({ data: {}, error: null }) }; } } });
mock.module("../src/services/scraper.js", { namedExports: { fetchAllSources: async () => ({ combinedText: "", sources: [], yelpId: null, osmFacilities: null }) } });
mock.module("../src/lib/gemini.js", { namedExports: { model: { generateContent: async () => { throw new Error("Gemini must not be called"); } }, embeddingModel: {} } });

const { default: prisma } = await import("../src/lib/prisma.js");
const { acquireRun, heartbeat, finishRun, RUN_STALE_AFTER_MS } = await import("../src/lib/enrichmentRuns.js");
const { runEnrichment } = await import("../src/lib/enrichmentCron.js");
const { default: enrichmentRouter } = await import("../src/routes/enrichment.js");
const { default: express } = await import("express");

const H = 3_600_000;
const ago = (h) => new Date(Date.now() - h * H);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server, base;
before(async () => {
    const app = express(); app.use("/enrichment", enrichmentRouter);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await prisma.$disconnect(); });
beforeEach(async () => { await prisma.enrichmentRun.deleteMany(); await prisma.location.deleteMany(); });

test("lock: the partial unique index exists and rejects a second 'running' row at the SQL level", async () => {
    const idx = await prisma.$queryRaw`SELECT indexdef FROM pg_indexes WHERE indexname = 'EnrichmentRun_one_running'`;
    assert.match(idx[0].indexdef, /UNIQUE.*\(status\).*WHERE.*'running'/i);
    await prisma.enrichmentRun.create({ data: { trigger: "cron" } });
    await assert.rejects(prisma.enrichmentRun.create({ data: { trigger: "trigger" } }), (e) => e.code === "P2002");
    // history rows are outside the index: any number of finished runs may coexist
    await prisma.enrichmentRun.updateMany({ data: { status: "success", finishedAt: new Date() } });
    for (let i = 0; i < 3; i++) await prisma.enrichmentRun.create({ data: { trigger: "cron", status: "success", finishedAt: new Date() } });
    assert.equal(await prisma.enrichmentRun.count(), 4);
});

test("lock holds across separate processes (a second OS process cannot acquire while this one holds it)", async () => {
    const mine = await acquireRun({ trigger: "cron" });
    assert.ok(mine);
    const child = (script) => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: process.env, encoding: "utf8", cwd: process.cwd() }).trim().split("\n").pop();
    const probe = `import { acquireRun } from "./src/lib/enrichmentRuns.js"; import prisma from "./src/lib/prisma.js";
        const r = await acquireRun({ trigger: "trigger" }); console.log(r ? "ACQUIRED" : "BLOCKED"); await prisma.$disconnect();`;
    assert.equal(child(probe), "BLOCKED");
    await finishRun(mine.id, { status: "success" });
    assert.equal(child(probe), "ACQUIRED");        // lock was released by finishRun, so the child can now take it
    assert.equal(await prisma.enrichmentRun.count({ where: { status: "running" } }), 1);
});

test("heartbeat: updates heartbeatAt and the live counts, and leaves the run 'running'", async () => {
    const run = await acquireRun({ trigger: "cron" });
    const before = (await prisma.enrichmentRun.findUnique({ where: { id: run.id } }));
    await sleep(60);
    await heartbeat(run.id, { planned: 5, updated: 2, skipped: 1, failed: 1 });
    const after = await prisma.enrichmentRun.findUnique({ where: { id: run.id } });
    assert.ok(after.heartbeatAt > before.heartbeatAt, "heartbeatAt should advance");
    assert.deepEqual([after.planned, after.updated, after.skipped, after.failed], [5, 2, 1, 1]);
    assert.equal(after.status, "running");
    assert.equal(after.finishedAt, null);
});

test("heartbeat: a real run beats once per place, so a long run is never mistaken for a dead one", async () => {
    await prisma.location.createMany({ data: [1, 2, 3].map((i) => ({ name: `P${i}`, latitude: 43.6, longitude: -79.4 })) });
    // age the run's start so we can tell heartbeats happened after acquisition
    const id = await runEnrichment({ trigger: "cron" });
    const r = await prisma.enrichmentRun.findUnique({ where: { id } });
    assert.equal(r.status, "success");
    assert.equal(r.planned, 3);
    assert.ok(r.heartbeatAt > r.startedAt);
    assert.equal(r.skipped + r.updated + r.failed, 3);
});

test("abandoned recovery: exactly at the 15 minute boundary; counts and trigger of the dead run are kept", async () => {
    assert.equal(RUN_STALE_AFTER_MS, 15 * 60 * 1000);
    // 14 min old heartbeat: still alive -> blocks
    const alive = await prisma.enrichmentRun.create({ data: { trigger: "trigger-force", force: true, heartbeatAt: new Date(Date.now() - 14 * 60_000), planned: 10, updated: 4 } });
    assert.equal(await acquireRun({ trigger: "cron" }), null);
    // 16 min old heartbeat: dead -> recovered
    await prisma.enrichmentRun.update({ where: { id: alive.id }, data: { heartbeatAt: new Date(Date.now() - 16 * 60_000) } });
    const next = await acquireRun({ trigger: "cron" });
    assert.ok(next);
    const dead = await prisma.enrichmentRun.findUnique({ where: { id: alive.id } });
    assert.equal(dead.status, "abandoned");
    assert.ok(dead.finishedAt);
    assert.match(dead.errorMessage, /heartbeat/i);
    assert.deepEqual([dead.planned, dead.updated, dead.trigger], [10, 4, "trigger-force"]);
    assert.equal(await prisma.enrichmentRun.count({ where: { status: "running" } }), 1);   // only the new run
});

test("freshness: 36h boundary, currentlyRunning, and strict mode with no runs / only failures", async () => {
    const get = (p) => fetch(base + p, { headers: { "x-n8n-secret": "test-secret" } });
    const success = await prisma.enrichmentRun.create({ data: { trigger: "cron", status: "success", startedAt: ago(35.5), finishedAt: ago(35.5) } });

    let r = await get("/enrichment/freshness?strict=true");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).healthy, true);

    await prisma.enrichmentRun.update({ where: { id: success.id }, data: { finishedAt: ago(36.5) } });
    r = await get("/enrichment/freshness?strict=true");
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.healthy, false);
    assert.ok(Math.abs(body.hoursSinceLastSuccess - 36.5) < 0.1);
    assert.equal((await get("/enrichment/freshness")).status, 200);          // non-strict is always 200

    // a currently running run is reported, and does not count as a success
    await prisma.enrichmentRun.create({ data: { trigger: "cron" } });
    body.currentlyRunning;
    const running = await (await get("/enrichment/freshness")).json();
    assert.equal(running.currentlyRunning, true);
    assert.equal(running.healthy, false);

    // no successful run ever (only a failure): unhealthy, hoursSinceLastSuccess null
    await prisma.enrichmentRun.deleteMany();
    await prisma.enrichmentRun.create({ data: { trigger: "cron", status: "failed", startedAt: ago(2), finishedAt: ago(2), failed: 3, planned: 3, errorMessage: "Every location failed" } });
    r = await get("/enrichment/freshness?strict=true");
    assert.equal(r.status, 503);
    const none = await r.json();
    assert.equal(none.hoursSinceLastSuccess, null);
    assert.equal(none.recentFailures.length, 1);

    // empty table: unhealthy too, and the endpoint still answers
    await prisma.enrichmentRun.deleteMany();
    r = await get("/enrichment/freshness?strict=true");
    assert.equal(r.status, 503);
    assert.equal((await r.json()).lastRun, null);
});
