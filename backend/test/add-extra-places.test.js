// Run: node --experimental-test-module-mocks --test test/add-extra-places.test.js  (no DB, no network: everything is injected)
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalDb, parseMapsCoords, resolveMapsUrl, nameOverlap, processRows } from "../scripts/add_extra_places.js";

const KEY = "AIza-test-key-123";
const place = (place_id, name, lat, lng, addr = "1 Main St, Oakville, ON") => ({ place_id, name, formatted_address: addr, geometry: { location: { lat, lng } } });

// Fixtures are written in the legacy shape (place_id, name, formatted_address, geometry); the fake Google below
// answers in the Places API (New) shape (id, displayName, formattedAddress, location), as the real one does.
const toNew = (p) => ({ id: p.place_id, displayName: { text: p.name }, formattedAddress: p.formatted_address, location: { latitude: p.geometry.location.lat, longitude: p.geometry.location.lng } });
function setup({ results = [], status = "OK", errorMessage, existing = new Set(), finalUrl = "https://www.google.com/maps/place/X/@43.4675,-79.6877,17z/data=!3d43.4675!4d-79.6877" } = {}) {
    const calls = [], reqs = [], creates = [], logs = [];
    const fetchImpl = async (url, opts) => {
        calls.push(String(url));
        if (String(url).includes("places.googleapis.com")) {
            reqs.push({ url: String(url), ...opts });
            if (status === "OK" || status === "ZERO_RESULTS") return { ok: true, status: 200, json: async () => (results.length ? { places: results.map(toNew) } : {}) };
            return { ok: false, status: 403, json: async () => ({ error: { code: 403, status, ...(errorMessage ? { message: errorMessage } : {}) } }) };
        }
        return { ok: true, status: 200, url: finalUrl };   // a Maps short link redirect
    };
    const prisma = { location: {
        findUnique: async ({ where }) => (existing.has(where.googlePlaceId) ? { id: "x" } : null),
        create: async (a) => { creates.push(a.data); return a.data; },
    } };
    return { calls, reqs, creates, logs, fetchImpl, prisma, log: (...a) => logs.push(a.join(" ")) };
}
const row = { name: "We Rock the Spectrum Kids Gym - Oakville", category: "fitness", mapsUrl: "https://maps.app.goo.gl/abc" };
const run = (s, rows, apply = false) => processRows(rows, { key: KEY, prisma: s.prisma, apply, fetchImpl: s.fetchImpl, log: s.log });

test("DB guard: only localhost / 127.0.0.1, unless explicitly overridden", () => {
    assertLocalDb("postgresql://u@127.0.0.1:55433/db");
    assertLocalDb("postgresql://u@localhost:5432/db");
    assert.throws(() => assertLocalDb("postgresql://u:p@db.abc.supabase.co:5432/postgres"), /Refusing to run/);
    assert.throws(() => assertLocalDb("postgresql://u@evil.com/localhost"), /Refusing to run/);
    assert.throws(() => assertLocalDb(undefined), /Refusing to run/);
    assert.doesNotThrow(() => assertLocalDb("postgresql://u@db.abc.supabase.co/postgres", { allowRemote: true }));
});

test("coordinates are parsed from the common Maps URL shapes", () => {
    assert.deepEqual(parseMapsCoords("https://www.google.com/maps/place/X/@43.4675,-79.6877,17z"), { lat: 43.4675, lng: -79.6877 });
    assert.deepEqual(parseMapsCoords("https://www.google.com/maps/place/X/data=!3d43.5!4d-79.9"), { lat: 43.5, lng: -79.9 });
    assert.deepEqual(parseMapsCoords("https://maps.google.com/?q=43.51,-79.96"), { lat: 43.51, lng: -79.96 });
    assert.deepEqual(parseMapsCoords("https://consent.google.com/m?continue=" + encodeURIComponent("https://www.google.com/maps/@43.1,-79.2,10z")), { lat: 43.1, lng: -79.2 });
    assert.equal(parseMapsCoords("https://maps.app.goo.gl/abc"), null);
    assert.equal(parseMapsCoords(null), null);
});

test("short links are followed; non-Google URLs are never fetched", async () => {
    const s = setup();
    assert.deepEqual(await resolveMapsUrl("https://maps.app.goo.gl/abc", s.fetchImpl), { lat: 43.4675, lng: -79.6877 });
    assert.equal(s.calls.length, 1);
    const s2 = setup();
    assert.equal(await resolveMapsUrl("https://evil.example.com/@43.1,-79.1", s2.fetchImpl), null);
    assert.equal(s2.calls.length, 0, "no request to a non-Google host");
});

test("name overlap ignores generic words and short words", () => {
    assert.equal(nameOverlap("We Rock the Spectrum Kids Gym - Oakville", "We Rock the Spectrum - Oakville"), 1);
    assert.ok(nameOverlap("We Rock the Spectrum Kids Gym - Oakville", "We Rock the Spectrum - Brampton") < 0.75);
    assert.equal(nameOverlap("", "x"), 0);
});

test("dry run (default): one text search per row, location-biased, nothing written", async () => {
    const s = setup({ results: [place("pid1", "We Rock the Spectrum - Oakville", 43.4675, -79.6877)] });
    const { summary } = await run(s, [row]);
    assert.equal(s.creates.length, 0);
    assert.deepEqual(summary, { inserted: 0, wouldInsert: 1, skipped: 0 });
    assert.equal(s.reqs.length, 1, "exactly one Places lookup per row");
    const sent = JSON.parse(s.reqs[0].body);
    assert.equal(sent.textQuery, row.name);
    assert.deepEqual(sent.locationBias.circle.center, { latitude: 43.4675, longitude: -79.6877 });
    assert.match(s.logs.join("\n"), /Dry run: would insert/);
    assert.ok(!s.logs.join("\n").includes(KEY), "the API key is never printed");
});

test("--apply inserts name/category/address/lat/lng only: no scores, description or image", async () => {
    const s = setup({ results: [place("pid1", "We Rock the Spectrum - Oakville", 43.4675, -79.6877)] });
    await run(s, [row], true);
    assert.equal(s.creates.length, 1);
    assert.deepEqual(Object.keys(s.creates[0]).sort(), ["address", "category", "googlePlaceId", "latitude", "longitude", "name"]);
    assert.equal(s.creates[0].googlePlaceId, "pid1");
    assert.equal(s.creates[0].category, "fitness");
});

test("a googlePlaceId that already exists is skipped, even with --apply", async () => {
    const s = setup({ results: [place("pid1", "We Rock the Spectrum - Oakville", 43.4675, -79.6877)], existing: new Set(["pid1"]) });
    const { summary } = await run(s, [row], true);
    assert.equal(s.creates.length, 0);
    assert.equal(summary.skipped, 1);
    assert.match(s.logs.join("\n"), /already exists/);
});

test("more than one plausible match: candidates are printed and the row is skipped", async () => {
    const s = setup({ results: [
        place("pidA", "Crawford Lake Conservation Area", 43.4675, -79.6877),
        place("pidB", "Crawford Lake Visitor Centre", 43.468, -79.688),
    ] });
    const { summary } = await run(s, [{ name: "Crawford Lake", category: "park", mapsUrl: "https://maps.app.goo.gl/abc" }], true);
    assert.equal(s.creates.length, 0);
    assert.equal(summary.skipped, 1);
    const out = s.logs.join("\n");
    assert.match(out, /more than one plausible match/);
    assert.match(out, /pidA/); assert.match(out, /pidB/);
});

test("a 'pick' place_id resolves an ambiguous row; a pick that is not a candidate is refused", async () => {
    const results = [place("pidA", "Crawford Lake Conservation Area", 43.4675, -79.6877), place("pidB", "Crawford Lake Visitor Centre", 43.468, -79.688)];
    const s = setup({ results });
    await run(s, [{ name: "Crawford Lake", category: "park", mapsUrl: "https://maps.app.goo.gl/abc", pick: "pidB" }], true);
    assert.equal(s.creates[0].googlePlaceId, "pidB");
    const s2 = setup({ results });
    const r = await run(s2, [{ name: "Crawford Lake", category: "park", mapsUrl: "https://maps.app.goo.gl/abc", pick: "nope" }], true);
    assert.equal(s2.creates.length, 0);
    assert.match(r.outcomes[0].reason, /not one of the returned candidates/);
});

test("no plausible match (wrong name or too far from the URL's coordinates): skipped with the results listed", async () => {
    const s = setup({ results: [place("far", "We Rock the Spectrum - Oakville", 44.5, -79.0), place("other", "Some Other Gym", 43.4675, -79.6877)] });
    const r = await run(s, [row], true);
    assert.equal(s.creates.length, 0);
    assert.equal(r.outcomes[0].reason, "no plausible match");
    assert.match(s.logs.join("\n"), /far/);
});

test("lookup errors (ZERO_RESULTS, REQUEST_DENIED, bad row) skip the row and never leak the key", async () => {
    for (const status of ["ZERO_RESULTS", "PERMISSION_DENIED"]) {
        const s = setup({ status });
        const r = await run(s, [row], true);
        assert.equal(s.creates.length, 0);
        assert.match(r.outcomes[0].reason, new RegExp(status));
        assert.ok(!s.logs.join("\n").includes(KEY));
    }
    const s = setup();
    const r = await run(s, [{ name: "No url", category: "park" }], true);
    assert.match(r.outcomes[0].reason, /needs name, category and mapsUrl/);
});

test("a network error never prints the key", async () => {
    const s = setup();
    s.fetchImpl = async (url) => { if (String(url).includes("googleapis")) throw new Error(`boom key=${KEY}`); return { ok: true, url: "https://www.google.com/maps/@43.4,-79.6,10z" }; };
    const r = await processRows([row], { key: KEY, prisma: s.prisma, apply: true, fetchImpl: s.fetchImpl, log: s.log });
    assert.equal(s.creates.length, 0);
    assert.ok(!s.logs.join("\n").includes(KEY) && !JSON.stringify(r).includes(KEY));
});

test("Places API (New): POST to places:searchText, key only in the X-Goog-Api-Key header, minimal field mask", async () => {
    const s = setup({ results: [place("pid1", "We Rock the Spectrum - Oakville", 43.4675, -79.6877)] });
    await run(s, [row]);
    const r = s.reqs[0];
    assert.equal(r.url, "https://places.googleapis.com/v1/places:searchText");
    assert.equal(r.method, "POST");
    assert.equal(r.headers["X-Goog-Api-Key"], KEY);
    assert.equal(r.headers["X-Goog-FieldMask"], "places.id,places.displayName,places.formattedAddress,places.location");
    assert.ok(!r.url.includes(KEY) && !r.url.includes("key="), "the key is not in the URL");
    assert.ok(!r.body.includes(KEY));
});

test("the new response is mapped to the same fields the legacy one gave (place_id, name, address, lat/lng)", async () => {
    const s = setup({ results: [place("pid1", "We Rock the Spectrum - Oakville", 43.4675, -79.6877, "1 Main St, Oakville, ON")] });
    await run(s, [row], true);
    assert.deepEqual(s.creates[0], { googlePlaceId: "pid1", name: "We Rock the Spectrum - Oakville", category: "fitness", address: "1 Main St, Oakville, ON", latitude: 43.4675, longitude: -79.6877 });
});

test("a denied lookup prints Google's error message, and never the key even if Google echoes it", async () => {
    const msg = "Places API (New) has not been used in project 123 before or it is disabled.";
    const s = setup({ status: "PERMISSION_DENIED", errorMessage: msg });
    const r = await run(s, [row], true);
    assert.equal(s.creates.length, 0);
    assert.equal(r.outcomes[0].reason, `Places lookup returned PERMISSION_DENIED: ${msg}`);
    assert.match(s.logs.join("\n"), /PERMISSION_DENIED: Places API \(New\) has not been used/);

    const s2 = setup({ status: "PERMISSION_DENIED", errorMessage: `API key ${KEY} not valid; key=${KEY}` });
    const r2 = await run(s2, [row], true);
    assert.ok(!s2.logs.join("\n").includes(KEY) && !JSON.stringify(r2).includes(KEY));
});

test("dry run is still the default with the new API: no insert without --apply", async () => {
    const s = setup({ results: [place("pid1", "We Rock the Spectrum - Oakville", 43.4675, -79.6877)] });
    await run(s, [row], false);
    assert.equal(s.creates.length, 0);
});
