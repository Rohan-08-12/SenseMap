// Run: node --experimental-test-module-mocks --test test/discover-cap-and-cache.test.js  (no DB, no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeLocationDb } from "./helpers/fakeLocationDb.js";
import { resolveGoogleResults, MAX_NEW_PER_SEARCH, RESULTS_CONSIDERED } from "../src/lib/discoverResolve.js";
import { createTtlPromiseCache } from "../src/lib/ttlPromiseCache.js";

const T = (i) => ({ place_id: `G${i}`, name: `Place ${i}`, geometry: { location: { lat: 43.7 + i * 0.01, lng: -79.4 } } });
const details = (id) => ({ name: `Place ${id.slice(1)}`, types: ["cafe"], formatted_address: "1 St", geometry: { location: { lat: 43.7 + Number(id.slice(1)) * 0.01, lng: -79.4 } }, photos: [{ photo_reference: "p" }] });
function deps(db) {
    const detailCalls = [];
    return { detailCalls, d: { prisma: db.prisma, getDetails: async (id) => { detailCalls.push(id); return details(id); }, classifyCategory: () => "cafe", inBounds: () => true, log: () => {} } };
}

test("10 results, none stored: only the first 3 are created (3 Details calls, not 10)", async () => {
    const db = fakeLocationDb();
    const { d, detailCalls } = deps(db);
    const out = await resolveGoogleResults(Array.from({ length: 12 }, (_, i) => T(i + 1)), d);
    assert.equal(MAX_NEW_PER_SEARCH, 3);
    assert.deepEqual(detailCalls, ["G1", "G2", "G3"]);
    assert.equal(db.log.creates.length, 3);
    assert.deepEqual(out.map((l) => l.googlePlaceId), ["G1", "G2", "G3"]);
    assert.equal(RESULTS_CONSIDERED, 10);
});

test("already-stored results are free and do not use up the 3; the cap counts only NEW places, in Google's order", async () => {
    const db = fakeLocationDb([{ id: "s2", googlePlaceId: "G2", name: "Place 2", latitude: 43.72, longitude: -79.4 }, { id: "s5", googlePlaceId: "G5", name: "Place 5", latitude: 43.75, longitude: -79.4 }]);
    const { d, detailCalls } = deps(db);
    const out = await resolveGoogleResults(Array.from({ length: 8 }, (_, i) => T(i + 1)), d);
    assert.deepEqual(detailCalls, ["G1", "G3", "G4"]);
    assert.deepEqual(out.map((l) => l.googlePlaceId), ["G1", "G2", "G3", "G4", "G5"]);   // result order kept
});

test("an OSM row matching by exact name gets the Google id: no Details call, no second row; a different real id is left alone", async () => {
    const db = fakeLocationDb([
        { id: "osm", googlePlaceId: "osm_node_1", name: "Place 1", category: "Cafe", latitude: 43.71, longitude: -79.4 },
        { id: "real", googlePlaceId: "ChIJreal", name: "Place 2", latitude: 43.72, longitude: -79.4 },
    ]);
    const { d, detailCalls } = deps(db);
    const out = await resolveGoogleResults([T(1), T(2)], d);
    assert.deepEqual(detailCalls, []);
    assert.equal(db.log.creates.length, 0);
    assert.equal(db.rows[0].googlePlaceId, "G1");
    assert.equal(db.rows[0].category, "Cafe");
    assert.equal(db.rows[1].googlePlaceId, "ChIJreal");
    assert.deepEqual(out.map((l) => l.id), ["osm", "real"]);
});

test("containment is not a duplicate: 'Woodside Square' stored, the library branch is created", async () => {
    const db = fakeLocationDb([{ id: "mall", googlePlaceId: "osm_node_7", name: "Woodside Square", latitude: 43.71, longitude: -79.4 }]);
    const { d } = deps(db);
    d.getDetails = async () => ({ name: "Toronto Public Library - Woodside Square", types: ["library"], formatted_address: "x", geometry: { location: { lat: 43.71, lng: -79.4 } } });
    await resolveGoogleResults([{ place_id: "GL", name: "Toronto Public Library - Woodside Square", geometry: { location: { lat: 43.71, lng: -79.4 } } }], d);
    assert.equal(db.log.creates.length, 1);
    assert.equal(db.rows[0].googlePlaceId, "osm_node_7");
});

test("out-of-bounds new places are not created; a lost create race returns the stored row", async () => {
    const db = fakeLocationDb();
    const { d, detailCalls } = deps(db);
    d.inBounds = () => false;
    assert.deepEqual(await resolveGoogleResults([T(1)], d), []);
    assert.deepEqual(detailCalls, []);
    const db2 = fakeLocationDb();
    const { d: d2 } = deps(db2);
    d2.getDetails = async (id) => { db2.rows.push({ id: "raced", googlePlaceId: id, name: "Place 1" }); return details(id); };
    const out = await resolveGoogleResults([T(1)], d2);
    assert.deepEqual(out.map((l) => l.id), ["raced"]);
});

test("ttl cache: identical searches share one promise for an hour, expire after, failures are not kept", async () => {
    let t = 0, runs = 0;
    const c = createTtlPromiseCache({ ttlMs: 3_600_000, max: 2, now: () => t });
    const work = () => c.get("k") ?? c.set("k", (async () => ++runs)());
    assert.equal(await work(), 1);
    t = 3_599_999; assert.equal(await work(), 1);
    t = 3_600_000; assert.equal(await work(), 2);
    c.set("bad", Promise.reject(new Error("x")));
    await new Promise((r) => setImmediate(r));
    assert.equal(c.get("bad"), undefined);
    c.set("a", Promise.resolve(1)); c.set("b", Promise.resolve(2)); c.set("c", Promise.resolve(3));
    assert.ok(c.size <= 2);
});
