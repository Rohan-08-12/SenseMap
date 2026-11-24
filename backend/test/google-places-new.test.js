// Run: node --experimental-test-module-mocks --test test/google-places-new.test.js  (no network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchTextNew, mapNewPlace, redactSecrets, MIN_FIELD_MASK } from "../src/lib/googlePlacesNew.js";

const KEY = "AIzaSyFAKEKEY1234567890abcdef";
const ok = (body, status = 200) => async () => ({ ok: status < 400, status, json: async () => body });

test("maps the new place shape to the legacy field names", () => {
    assert.deepEqual(mapNewPlace({ id: "p1", displayName: { text: "Cafe", languageCode: "en" }, formattedAddress: "1 St", location: { latitude: 1.5, longitude: -2.5 } }),
        { place_id: "p1", name: "Cafe", formatted_address: "1 St", geometry: { location: { lat: 1.5, lng: -2.5 } } });
    assert.equal(mapNewPlace({ id: "p2" }).geometry, undefined);
});

test("no places => ZERO_RESULTS; places => OK", async () => {
    assert.equal((await searchTextNew("x", { key: KEY, fetchImpl: ok({}) })).status, "ZERO_RESULTS");
    const r = await searchTextNew("x", { key: KEY, fetchImpl: ok({ places: [{ id: "p", displayName: { text: "A" }, location: { latitude: 1, longitude: 2 } }] }) });
    assert.equal(r.status, "OK"); assert.equal(r.places[0].place_id, "p");
});

test("sends only the minimal field mask and no bias without coordinates", async () => {
    let sent;
    await searchTextNew("Mountsberg", { key: KEY, fetchImpl: async (u, o) => { sent = o; return { ok: true, json: async () => ({}) }; } });
    assert.equal(sent.headers["X-Goog-FieldMask"], MIN_FIELD_MASK);
    assert.deepEqual(JSON.parse(sent.body), { textQuery: "Mountsberg" });
});

test("the radius is capped at the API maximum of 50000 m", async () => {
    let sent;
    await searchTextNew("x", { lat: 1, lng: 2, radius: 90000, key: KEY, fetchImpl: async (u, o) => { sent = o; return { ok: true, json: async () => ({}) }; } });
    assert.equal(JSON.parse(sent.body).locationBias.circle.radius, 50000);
});

test("HTTP errors return Google's status and message, redacted", async () => {
    const r = await searchTextNew("x", { key: KEY, fetchImpl: ok({ error: { code: 403, status: "PERMISSION_DENIED", message: `API key ${KEY} is blocked` } }, 403) });
    assert.equal(r.status, "PERMISSION_DENIED");
    assert.match(r.errorMessage, /is blocked/);
    assert.ok(!r.errorMessage.includes(KEY));
});

test("a non-JSON error body falls back to HTTP_<code>; a network error never leaks the key", async () => {
    const r = await searchTextNew("x", { key: KEY, fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error("not json"); } }) });
    assert.equal(r.status, "HTTP_502");
    const n = await searchTextNew("x", { key: KEY, fetchImpl: async () => { throw new Error(`socket hang up key=${KEY}`); } });
    assert.equal(n.status, "NETWORK_ERROR");
    assert.ok(!JSON.stringify(n).includes(KEY));
});

test("redactSecrets removes the exact key, key= params and AIza-shaped strings", () => {
    const out = redactSecrets(`a ${KEY} b key=abc123&x=1 c AIzaSyOTHERKEYOTHERKEY123`, KEY);
    assert.ok(!/AIza|abc123/.test(out));
});
