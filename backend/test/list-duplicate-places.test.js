// Run: node --experimental-test-module-mocks --test test/list-duplicate-places.test.js  (no DB)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertLocalDb, findDuplicateGroups, report, normalizeName } from "../scripts/list_duplicate_places.js";

const row = (id, name, lat, lng, extra = {}) => ({ id, name, latitude: lat, longitude: lng, address: null, category: "cafe", googlePlaceId: id, imageUrl: null, estimatedNoiseScore: null, sensoryScores: null, _count: { reviews: 0, savedBy: 0, checkIns: 0 }, ...extra });

test("it contains no code that writes: no delete, update, create, upsert or raw SQL", () => {
    const src = fs.readFileSync(new URL("../scripts/list_duplicate_places.js", import.meta.url), "utf8")
        .split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");   // ignore comments
    assert.doesNotMatch(src, /\.(delete|deleteMany|update|updateMany|create|createMany|upsert|\$executeRaw|\$queryRaw|\$executeRawUnsafe)\b/);
    assert.doesNotMatch(src, /\b(DELETE|UPDATE|INSERT|DROP|TRUNCATE)\b/);
});

test("refuses a non-localhost DATABASE_URL unless --allow-remote-db", () => {
    assert.doesNotThrow(() => assertLocalDb("postgresql://u@127.0.0.1:5432/x"));
    assert.doesNotThrow(() => assertLocalDb("postgresql://u@localhost/x"));
    assert.throws(() => assertLocalDb("postgresql://u:p@db.abc.supabase.co:5432/postgres"), /Refusing to run/);
    assert.throws(() => assertLocalDb(undefined), /Refusing to run/);
    assert.doesNotThrow(() => assertLocalDb("postgresql://u@db.abc.supabase.co/x", { allowRemote: true }));
});

test("groups same-name places within 100 m; leaves far apart branches and different names alone", () => {
    const rows = [
        row("a", "Pilot Coffee Roasters", 43.6500, -79.3800),
        row("b", "Pilot Coffee Roasters", 43.6501, -79.3801),       // ~14 m from a: duplicate
        row("c", "Pilot Coffee Roasters", 43.6600, -79.3800),       // ~1.1 km away: a different branch
        row("d", "Sam James Coffee Bar", 43.6700, -79.4000),
        row("e", "Sam James Coffee Bar at General Assembly Pizza", 43.6701, -79.4001),   // contains the other name: matches
        row("f", "Totally Different Cafe", 43.6700, -79.4000),
    ];
    const groups = findDuplicateGroups(rows).map((g) => g.map((r) => r.id).sort());
    assert.deepEqual(groups.sort(), [["a", "b"], ["d", "e"]]);
});

test("a custom radius, punctuation/case differences, and transitive groups", () => {
    const rows = [row("a", "Café  Pilot!", 43.65, -79.38), row("b", "cafe pilot", 43.6503, -79.38), row("c", "CAFE PILOT", 43.6506, -79.38)];
    assert.equal(normalizeName("Café  Pilot!"), "cafpilot");   // accents are not folded, so "Café" and "cafe" are not the same name
    assert.deepEqual(findDuplicateGroups(rows).map((g) => g.map((r) => r.id).sort()), [["b", "c"]], "a (with the accent) does not match; b and c are 33 m apart");
    assert.deepEqual(findDuplicateGroups(rows, 10), []);
    assert.deepEqual(findDuplicateGroups([row("x", "Same", 1, 1), row("y", "Same", 1.0002, 1), row("z", "Same", 1.0004, 1)], 30).map((g) => g.length), [3], "chains of near neighbours form one group");
});

test("report prints names, addresses, ids and what each row has, and only reads", async () => {
    const calls = [];
    const prisma = { location: { findMany: async (a) => { calls.push(a); return [
        row("id-1", "Pilot Coffee Roasters", 43.65, -79.38, { address: "50 Wellington St E", sensoryScores: { reviewCount: 2 }, _count: { reviews: 2, savedBy: 1, checkIns: 3 } }),
        row("id-2", "Pilot Coffee Roasters", 43.65, -79.3801, { estimatedNoiseScore: 2 }),
    ]; } } };
    const out = [];
    const groups = await report(prisma, { log: (...a) => out.push(a.join(" ")) });
    assert.equal(groups.length, 1);
    assert.equal(calls.length, 1);
    const text = out.join("\n");
    assert.match(text, /id-1 \| Pilot Coffee Roasters \| 50 Wellington St E/);
    assert.match(text, /scores row \(reviewCount 2\); reviews: 2; saved by: 1; check-ins: 3/);
    assert.match(text, /AI estimate only/);
    assert.match(text, /read-only, nothing changed/);
});
