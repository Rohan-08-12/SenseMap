// Run: node --experimental-test-module-mocks --test test/cleanup-non-toronto.test.js  (no DB: prisma is injected)
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, BOUNDS } from "../cleanup_non_toronto.js";

function fakePrisma(n) {
    const deletes = [];
    const rows = Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `Place ${i + 1}`, latitude: 43.5, longitude: -80 }));
    const del = (model) => async (a) => { deletes.push([model, a.where]); return { count: rows.length }; };
    return { deletes, prisma: {
        location: { findMany: async () => rows, deleteMany: del("location") },
        review: { deleteMany: del("review") }, sensoryScore: { deleteMany: del("sensoryScore") },
        savedPlace: { deleteMany: del("savedPlace") }, checkIn: { deleteMany: del("checkIn") },
    } };
}
const capture = () => { const logs = []; return { logs, log: (...a) => logs.push(a.join(" ")) }; };

test("without --confirm: prints the count and the first 20 names, deletes nothing, exits non-zero", async () => {
    const { prisma, deletes } = fakePrisma(25);
    const c = capture();
    const r = await run(prisma, { confirm: false, log: c.log });
    assert.equal(deletes.length, 0, "no delete call of any kind");
    assert.equal(r.exitCode, 1);
    assert.equal(r.deleted, 0);
    const out = c.logs.join("\n");
    assert.match(out, /Found 25 locations/);
    assert.match(out, /Place 20 /);
    assert.doesNotMatch(out, /Place 21 /);
    assert.match(out, /and 5 more/);
    assert.match(out, /--confirm/);
});

test("without --confirm and 3 rows: all three names, still no delete", async () => {
    const { prisma, deletes } = fakePrisma(3);
    const c = capture();
    await run(prisma, { log: c.log });
    assert.equal(deletes.length, 0);
    assert.match(c.logs.join("\n"), /Place 3 /);
    assert.doesNotMatch(c.logs.join("\n"), /more\b/);
});

test("with --confirm: deletes dependents then locations", async () => {
    const { prisma, deletes } = fakePrisma(2);
    const r = await run(prisma, { confirm: true, log: capture().log });
    assert.equal(r.exitCode, 0);
    assert.deepEqual(deletes.map((d) => d[0]), ["review", "sensoryScore", "savedPlace", "checkIn", "location"]);
});

test("nothing outside the box: nothing to delete, exit 0, with or without --confirm", async () => {
    const { prisma, deletes } = fakePrisma(0);
    assert.equal((await run(prisma, { log: capture().log })).exitCode, 0);
    assert.equal(deletes.length, 0);
});

test("the box is unchanged", () => {
    assert.deepEqual(BOUNDS, { latMin: 43.4, latMax: 43.9, lngMin: -79.75, lngMax: -79.0 });
});
