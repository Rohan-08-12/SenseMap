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
const { TEXT_SEARCH_URL } = await import("../src/lib/placesSearch.js");

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

// The script moved to Places API (New) (the legacy API can't be enabled on new projects), so it intentionally no longer
// shares the app's legacy request. These tests pin what it sends instead.
test("the script's lookup is a Places API (New) Text Search: POST, key only in the header, minimal field mask", async () => {
    const c = capture(); const sent = [];
    const fetchImpl = async (u, o) => { sent.push({ u: String(u), o }); return c.fetchImpl(u, o); };
    await textSearch({ name: "Crawford Lake" }, { lat: 43.47, lng: -79.95 }, { key: process.env.GOOGLE_PLACES_KEY, fetchImpl });
    assert.equal(sent[0].u, "https://places.googleapis.com/v1/places:searchText");
    assert.equal(sent[0].o.method, "POST");
    assert.equal(sent[0].o.headers["X-Goog-Api-Key"], "AIza-env-key");
    assert.equal(sent[0].o.headers["X-Goog-FieldMask"], "places.id,places.displayName,places.formattedAddress,places.location");
    assert.ok(!sent[0].u.includes("AIza"), "no key in the URL");
    const body = JSON.parse(sent[0].o.body);
    assert.equal(body.textQuery, "Crawford Lake");
    assert.deepEqual(body.locationBias.circle, { center: { latitude: 43.47, longitude: -79.95 }, radius: 2000 });
});

test("without coordinates the script sends only textQuery (no location bias)", async () => {
    let body;
    await textSearch({ name: "Mountsberg" }, null, { key: "k1", fetchImpl: async (u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({}) }; } });
    assert.deepEqual(body, { textQuery: "Mountsberg" });
});
