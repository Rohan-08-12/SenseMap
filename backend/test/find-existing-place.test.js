// Run: node --experimental-test-module-mocks --test test/find-existing-place.test.js  (no DB)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeLocationDb } from "./helpers/fakeLocationDb.js";
import { normalisedNames, namesMatchExactly, findExistingPlace, attachGoogleId } from "../src/lib/findExistingPlace.js";

test("normalisation: case, trim, apostrophes, punctuation, ';' alternatives", () => {
    assert.deepEqual(normalisedNames("  Tim Horton's  "), ["tim hortons"]);
    assert.deepEqual(normalisedNames("Tim Horton’s"), ["tim hortons"]);
    assert.deepEqual(normalisedNames("Café-Bar, The  (Annex)"), ["café bar the annex"]);
    assert.deepEqual(normalisedNames("Crawford Lake; Crawford Lake Conservation Area"), ["crawford lake", "crawford lake conservation area"]);
    assert.deepEqual(normalisedNames(null), []);
    assert.ok(namesMatchExactly("CRAWFORD LAKE", "Crawford Lake;Other"));
    assert.ok(namesMatchExactly("Other; crawford lake ", "Crawford Lake"));
});

test("containment is NOT a match (the two cases from the brief)", () => {
    assert.equal(namesMatchExactly("Toronto Public Library - Woodside Square", "Woodside Square"), false);
    assert.equal(namesMatchExactly("Woodside Square", "Toronto Public Library - Woodside Square"), false);
    assert.equal(namesMatchExactly("Cineplex Cinemas Empress Walk", "Empress Walk"), false);
    assert.equal(namesMatchExactly("Empress Walk", "Cineplex Cinemas Empress Walk"), false);
});

const at = { latitude: 43.7, longitude: -79.4 };
const metresNorth = (m) => ({ latitude: 43.7 + m / 111_320, longitude: -79.4 });

test("google id wins; then exact name within 100 m (99 m yes, 101 m no); the closest of several wins", async () => {
    const { prisma } = fakeLocationDb([
        { id: "a", googlePlaceId: "G1", name: "Anything", ...at },
        { id: "b", googlePlaceId: "osm_node_1", name: "Cafe Nine", ...metresNorth(99) },
        { id: "c", googlePlaceId: "osm_node_2", name: "Cafe Ten", ...metresNorth(101) },
        { id: "d", googlePlaceId: "osm_node_3", name: "Cafe Eleven", ...metresNorth(60) },
        { id: "e", googlePlaceId: "osm_node_4", name: "Cafe Eleven", ...metresNorth(20) },
    ]);
    assert.equal((await findExistingPlace(prisma, { googlePlaceId: "G1", name: "zzz", lat: 0, lng: 0 })).location.id, "a");
    assert.equal((await findExistingPlace(prisma, { googlePlaceId: "GX", name: "cafe nine", ...{ lat: 43.7, lng: -79.4 } })).location.id, "b");
    assert.equal(await findExistingPlace(prisma, { googlePlaceId: "GX", name: "Cafe Ten", lat: 43.7, lng: -79.4 }), null);
    const m = await findExistingPlace(prisma, { googlePlaceId: "GX", name: "Cafe Eleven", lat: 43.7, lng: -79.4 });
    assert.equal(m.location.id, "e");
    assert.equal(m.matchedBy, "name");
});

test("no coordinates or no name: only the id lookup can match", async () => {
    const { prisma, log } = fakeLocationDb([{ id: "a", googlePlaceId: "G1", name: "X", ...at }]);
    assert.equal(await findExistingPlace(prisma, { googlePlaceId: "G2", name: "X" }), null);
    assert.equal(log.findMany, 0);
});

test("attachGoogleId: OSM row gets the id, keeps its id, category spelling and everything else; null category is filled", async () => {
    const { prisma, rows } = fakeLocationDb([
        { id: "o1", googlePlaceId: "osm_node_9", name: "N", category: "Cafe", ...at },
        { id: "o2", googlePlaceId: null, name: "N2", category: null, ...at },
    ]);
    const r1 = await attachGoogleId(prisma, rows[0], { googlePlaceId: "G9", category: "cafe" });
    assert.equal(r1.attached, true);
    assert.equal(rows[0].googlePlaceId, "G9");
    assert.equal(rows[0].category, "Cafe");          // not "cafe"
    assert.equal(rows[0].id, "o1");
    const r2 = await attachGoogleId(prisma, rows[1], { googlePlaceId: "G8", category: "cafe" });
    assert.equal(r2.attached, true);
    assert.equal(rows[1].category, "cafe");
});

test("attachGoogleId never overwrites a real Google id, and loses cleanly to a concurrent change", async () => {
    const { prisma, rows, log } = fakeLocationDb([{ id: "r", googlePlaceId: "ChIJreal", name: "N", ...at }, { id: "o", googlePlaceId: "osm_node_1", name: "N", ...at }]);
    const r = await attachGoogleId(prisma, rows[0], { googlePlaceId: "ChIJother" });
    assert.equal(r.attached, false);
    assert.equal(rows[0].googlePlaceId, "ChIJreal");
    assert.equal(log.updates.length, 0);
    const stale = { ...rows[1] };            // we read osm_node_1 ...
    rows[1].googlePlaceId = "ChIJwonFirst";  // ... another request attached its id first
    const r2 = await attachGoogleId(prisma, stale, { googlePlaceId: "ChIJmine" });
    assert.equal(r2.attached, false);
    assert.equal(rows[1].googlePlaceId, "ChIJwonFirst");
});
