// Run: node --experimental-test-module-mocks --test test/google-places-issues.test.js  (axios mocked, no network)
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let responder = () => ({ data: { status: "OK", results: [] } });
const requested = [];
mock.module("axios", { defaultExport: { get: async (url, opts) => { requested.push(url); return responder(url, opts); } } });
const { fetchGooglePlaces } = await import("../src/services/scraper.js");

const logs = [];
const origWarn = console.warn;
beforeEach(() => { logs.length = 0; requested.length = 0; console.warn = (...a) => logs.push(a.join(" ")); process.env.GOOGLE_PLACES_KEY = "AIzaSECRETSECRETSECRET1234"; });
test.after(() => { console.warn = origWarn; });

test("REQUEST_DENIED: one log line, issue reported, no key in the log", async () => {
    responder = () => ({ data: { status: "REQUEST_DENIED", error_message: "The provided API key is invalid. key=AIzaSECRETSECRETSECRET1234", results: [] } });
    const r = await fetchGooglePlaces("Cafe X", 43.6, -79.4);
    assert.deepEqual(r, { text: "", issue: "REQUEST_DENIED" });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[Google Places\] textsearch issue=REQUEST_DENIED place="Cafe X"/);
    assert.doesNotMatch(logs[0], /AIza|SECRET/);
});

test("OVER_QUERY_LIMIT on the details call is reported too", async () => {
    responder = (url) => url.includes("textsearch")
        ? { data: { status: "OK", results: [{ place_id: "p1", geometry: { location: { lat: 43.6, lng: -79.4 } } }] } }
        : { data: { status: "OVER_QUERY_LIMIT" } };
    const r = await fetchGooglePlaces("Cafe X", 43.6, -79.4);
    assert.equal(r.issue, "OVER_QUERY_LIMIT");
    assert.match(logs[0], /details issue=OVER_QUERY_LIMIT/);
});

test("HTTP error: reported as http_<code>, key not logged even if the error text has it", async () => {
    responder = () => { const e = new Error("Request failed with status code 403 https://x?key=AIzaSECRETSECRETSECRET1234"); e.response = { status: 403, data: {} }; throw e; };
    const r = await fetchGooglePlaces("Cafe X", 43.6, -79.4);
    assert.equal(r.issue, "http_403");
    assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /AIza|SECRET/);
});

test("network error (no response) and missing key", async () => {
    responder = () => { const e = new Error("timeout"); e.code = "ECONNABORTED"; throw e; };
    assert.equal((await fetchGooglePlaces("A", 1, 1)).issue, "network_ECONNABORTED");
    delete process.env.GOOGLE_PLACES_KEY;
    assert.equal((await fetchGooglePlaces("A", 1, 1)).issue, "no_api_key");
});

test("normal answers are not issues and log nothing: no match, and a full result", async () => {
    responder = () => ({ data: { status: "ZERO_RESULTS", results: [] } });
    assert.deepEqual(await fetchGooglePlaces("A", 1, 1), { text: "", issue: null });
    responder = (url) => url.includes("textsearch")
        ? { data: { status: "OK", results: [{ place_id: "p1", geometry: { location: { lat: 43.6, lng: -79.4 } } }] } }
        : { data: { status: "OK", result: { rating: 4.5, user_ratings_total: 10, editorial_summary: { overview: "Calm." } } } };
    const r = await fetchGooglePlaces("A", 43.6, -79.4);
    assert.equal(r.issue, null); assert.match(r.text, /Google rating: 4.5\/5.*Calm\./);
    assert.equal(logs.length, 0);
});
