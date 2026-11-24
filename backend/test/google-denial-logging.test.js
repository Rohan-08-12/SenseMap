// Run: node --experimental-test-module-mocks --test test/google-denial-logging.test.js  (no DB, no network)
// Denied legacy Google calls must be logged with Google's message (key redacted); return values stay as before.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let uploadError = null;
mock.module("../src/lib/prisma.js", { defaultExport: {} });
mock.module("../src/lib/cloudinary.js", { defaultExport: { uploader: { upload: async () => { if (uploadError) throw uploadError; return { secure_url: "https://img" }; } } } });
const KEY = "AIzaSyFAKEKEY1234567890abcdef";
process.env.GOOGLE_PLACES_KEY = KEY;
const { searchGooglePlaces, getGooglePlaceDetails, uploadPlacePhoto } = await import("../src/lib/placesService.js");
const { logGoogleDenial } = await import("../src/lib/googleIssue.js");

const warns = [], errs = [];
const ow = console.warn, oe = console.error;
test.beforeEach(() => { warns.length = 0; errs.length = 0; console.warn = (...a) => warns.push(a.join(" ")); console.error = (...a) => errs.push(a.join(" ")); });
test.afterEach(() => { console.warn = ow; console.error = oe; globalThis.fetch = origFetch; });
const origFetch = globalThis.fetch;
const reply = (body) => { globalThis.fetch = async () => ({ ok: true, json: async () => body }); };

test("textsearch REQUEST_DENIED: one log line with Google's message and no key; still returns []", async () => {
    reply({ status: "REQUEST_DENIED", error_message: `The provided API key is invalid. key=${KEY}`, results: [] });
    assert.deepEqual(await searchGooglePlaces("cafe", 43.65, -79.38), []);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /\[Google Places\] textsearch issue=REQUEST_DENIED for="cafe" detail="The provided API key is invalid/);
    assert.ok(!warns[0].includes(KEY));
});

test("details REQUEST_DENIED: logged; still returns null", async () => {
    reply({ status: "REQUEST_DENIED", error_message: "You're calling a legacy API, which is not enabled for your project." });
    assert.equal(await getGooglePlaceDetails("pid1"), null);
    assert.match(warns[0], /details issue=REQUEST_DENIED for="pid1" detail="You're calling a legacy API/);
});

test("OK and ZERO_RESULTS are not logged; results are unchanged", async () => {
    reply({ status: "OK", results: [{ place_id: "a", geometry: { location: { lat: 43.65, lng: -79.38 } } }, { place_id: "far", geometry: { location: { lat: 10, lng: 10 } } }] });
    assert.deepEqual((await searchGooglePlaces("x")).map((p) => p.place_id), ["a"]);   // Toronto-box filter unchanged
    reply({ status: "ZERO_RESULTS", results: [] });
    await searchGooglePlaces("x");
    assert.equal(warns.length, 0);
});

test("a photo upload failure whose message contains the key URL is logged without the key", async () => {
    uploadError = new Error(`Error in loading https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=r&key=${KEY} - 403`);
    assert.equal(await uploadPlacePhoto("r"), null);
    assert.equal(errs.length, 1);
    assert.match(errs[0], /Photo upload failed/);
    assert.ok(!errs[0].includes(KEY));
    uploadError = null;
});

test("logGoogleDenial ignores responses without a status", () => {
    assert.equal(logGoogleDenial("x", {}), null);
    assert.equal(logGoogleDenial("x", undefined), null);
    assert.equal(warns.length, 0);
});
