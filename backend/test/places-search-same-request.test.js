// Run: node --experimental-test-module-mocks --test test/places-search-same-request.test.js  (no DB, no network)
// The script and the app must send Google the same request: same legacy Text Search endpoint, key as the
// `key` query parameter (no header), key read from GOOGLE_PLACES_KEY.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../src/lib/prisma.js", { defaultExport: {} });
mock.module("../src/lib/cloudinary.js", { defaultExport: {} });
process.env.GOOGLE_PLACES_KEY = "AIza-env-key";
const { searchGooglePlaces } = await import("../src/lib/placesService.js");
const { textSearch } = await import("../scripts/add_extra_places.js");
const { buildTextSearchUrl, TEXT_SEARCH_URL } = await import("../src/lib/placesSearch.js");

const capture = () => { const urls = []; const headers = []; return { urls, headers, fetchImpl: async (u, o) => { urls.push(String(u)); headers.push(o?.headers); return { ok: true, json: async () => ({ status: "OK", results: [] }) }; } }; };

test("endpoint is the legacy Text Search endpoint, as in the app", () => {
    assert.equal(TEXT_SEARCH_URL, "https://maps.googleapis.com/maps/api/place/textsearch/json");
});

test("the app's searchGooglePlaces reads GOOGLE_PLACES_KEY and sends it as ?key= with no auth header", async () => {
    const c = capture();
    const orig = globalThis.fetch; globalThis.fetch = c.fetchImpl;
    try { await searchGooglePlaces("cafe", 43.65, -79.38); } finally { globalThis.fetch = orig; }
    const u = new URL(c.urls[0]);
    assert.equal(u.origin + u.pathname, TEXT_SEARCH_URL);
    assert.equal(u.searchParams.get("key"), "AIza-env-key");
    assert.equal(u.searchParams.get("query"), "cafe");
    assert.equal(u.searchParams.get("location"), "43.65,-79.38");
    assert.equal(u.searchParams.get("radius"), "30000");
    assert.equal(c.headers[0], undefined, "no header carries the key");
});

test("the script's lookup uses the same endpoint, auth style and key variable as the app", async () => {
    const c = capture();
    await textSearch({ name: "Crawford Lake" }, { lat: 43.47, lng: -79.95 }, { key: process.env.GOOGLE_PLACES_KEY, fetchImpl: c.fetchImpl });
    const u = new URL(c.urls[0]);
    assert.equal(u.origin + u.pathname, TEXT_SEARCH_URL);
    assert.equal(u.searchParams.get("key"), "AIza-env-key");
    assert.equal(u.searchParams.get("query"), "Crawford Lake");
    assert.equal(u.searchParams.get("location"), "43.47,-79.95");
    assert.equal(u.searchParams.get("radius"), "2000");
    assert.equal(c.headers[0], undefined);
    // identical to what the app's builder produces for the same inputs
    assert.equal(c.urls[0], buildTextSearchUrl({ query: "Crawford Lake", lat: 43.47, lng: -79.95, radius: 2000 }));
});

test("without coordinates the script sends only query + key (no location or radius)", async () => {
    const c = capture();
    await textSearch({ name: "Mountsberg" }, null, { key: "k1", fetchImpl: c.fetchImpl });
    const u = new URL(c.urls[0]);
    assert.deepEqual([...u.searchParams.keys()].sort(), ["key", "query"]);
});
