/**
 * Add a handful of hand-picked places (e.g. outside the City of Toronto) to the Location table.
 *
 * For each row of the input JSON ({ name, category, mapsUrl }) it makes ONE Google Places text search
 * (location-biased to the coordinates in the Maps URL when there are any) and prints what it found.
 * It sets NO sensory scores, description or image: the app shows "too little data" until reviews or the
 * nightly enrichment add some. DRY RUN by default; nothing is written without --apply.
 *
 * USAGE (from backend/; GOOGLE_PLACES_KEY and DATABASE_URL come from .env or the environment, never printed):
 *   node scripts/add_extra_places.js scripts/extra_places.json                      # dry run
 *   node scripts/add_extra_places.js scripts/extra_places.json --apply              # insert
 *   node scripts/add_extra_places.js scripts/extra_places.json --apply --allow-remote-db   # non-local DATABASE_URL
 *
 * RULES
 *  - Refuses to run unless DATABASE_URL's host is localhost / 127.0.0.1, unless --allow-remote-db is given.
 *    (The database is read even in a dry run, to skip places that already exist.)
 *  - A row whose resolved googlePlaceId already exists is skipped.
 *  - If more than one plausible match comes back, the candidates are printed and the row is skipped. To resolve
 *    it, put the chosen candidate's place_id in the row as "pick": "<place_id>" and re-run.
 *  - COST: one Google Places Text Search request per row (Maps short links are followed with a plain HTTP GET,
 *    which is not a Places API call). No Details, photo, Gemini or Cloudinary calls.
 */
import "dotenv/config";
import fs from "node:fs";
import { haversineMetres } from "../src/lib/geo.js";

const MAPS_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|www\.google\.com|google\.com|maps\.google\.com|consent\.google\.com)$/;
const MAX_DISTANCE_M = 10_000;     // a plausible match is within 10 km of the Maps URL's coordinates
const MIN_NAME_OVERLAP = 0.75;     // share of the row name's significant words that the candidate's name has
const STOPWORDS = new Set(["the", "and", "for", "kids", "gym", "park", "centre", "center", "area", "conservation"]);

export function assertLocalDb(url, { allowRemote = false } = {}) {
    if (allowRemote) return;
    let host = "";
    try { host = new URL(url).hostname; } catch { /* handled below */ }
    if (host !== "localhost" && host !== "127.0.0.1") {
        throw new Error("Refusing to run: DATABASE_URL must point at localhost / 127.0.0.1 (pass --allow-remote-db to override on purpose).");
    }
}

/** lat/lng from a (long) Google Maps URL, or null. */
export function parseMapsCoords(url) {
    if (!url) return null;
    let s = String(url);
    try { s = decodeURIComponent(s); } catch { /* keep raw */ }
    const m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|ll|center)=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Follows a Maps link (short links included) and returns the coordinates in the final URL, or null. */
export async function resolveMapsUrl(url, fetchImpl = fetch) {
    if (!url) return null;
    let host;
    try { host = new URL(url).hostname; } catch { return null; }
    if (!MAPS_HOSTS.test(host)) return null;   // only ever fetch Google Maps links
    const direct = parseMapsCoords(url);
    if (direct) return direct;
    try {
        const res = await fetchImpl(url, { redirect: "follow" });
        return parseMapsCoords(res.url);       // a consent page keeps the target in ?continue=, which parseMapsCoords decodes
    } catch {
        return null;
    }
}

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));

/** 0..1: share of the row name's significant words found in the candidate name. */
export function nameOverlap(rowName, candidateName) {
    const want = words(rowName);
    if (want.length === 0) return 0;
    const have = new Set(words(candidateName));
    return want.filter((w) => have.has(w)).length / want.length;
}

export function plausibleCandidates(row, results, coords) {
    const seen = new Set();
    return (results || []).filter((p) => {
        if (!p?.place_id || seen.has(p.place_id)) return false;
        seen.add(p.place_id);
        if (nameOverlap(row.name, p.name) < MIN_NAME_OVERLAP) return false;
        const loc = p.geometry?.location;
        if (!loc) return false;
        if (coords && haversineMetres(coords.lat, coords.lng, loc.lat, loc.lng) > MAX_DISTANCE_M) return false;
        return true;
    });
}

/** The single Places lookup for a row. Returns { status, results } (never throws, never includes the key). */
export async function textSearch(row, coords, { key, fetchImpl = fetch }) {
    const params = new URLSearchParams({ query: row.name, key });
    if (coords) { params.set("location", `${coords.lat},${coords.lng}`); params.set("radius", "2000"); }
    try {
        const res = await fetchImpl(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
        if (!res.ok) return { status: `HTTP_${res.status}`, results: [] };
        const data = await res.json();
        return { status: data.status || "UNKNOWN", results: data.results || [] };
    } catch (err) {
        return { status: `NETWORK_ERROR (${String(err.message).replace(key, "***")})`, results: [] };
    }
}

const describe = (p) => `${p.name} | ${p.formatted_address} | ${p.geometry?.location?.lat},${p.geometry?.location?.lng} | ${p.place_id}`;

/** Resolves every row; inserts only when apply is true. Returns a summary and per-row outcomes. */
export async function processRows(rows, { key, prisma, apply = false, fetchImpl = fetch, log = console.log }) {
    const outcomes = [];
    for (const row of rows) {
        const out = { name: row.name, action: "skip", reason: "" };
        outcomes.push(out);
        log(`\n— ${row.name} [${row.category ?? "no category"}]`);
        if (!row.name || !row.category || !row.mapsUrl) { out.reason = "row needs name, category and mapsUrl"; log(`  SKIP: ${out.reason}`); continue; }

        const coords = await resolveMapsUrl(row.mapsUrl, fetchImpl);
        log(coords ? `  Maps URL coordinates: ${coords.lat}, ${coords.lng}` : "  No coordinates found in the Maps URL; searching by name only");

        const { status, results } = await textSearch(row, coords, { key, fetchImpl });
        if (status !== "OK") { out.reason = `Places lookup returned ${status}`; log(`  SKIP: ${out.reason}`); continue; }

        let plausible = plausibleCandidates(row, results, coords);
        if (row.pick) {
            const picked = results.find((p) => p.place_id === row.pick);
            if (!picked) { out.reason = "pick is not one of the returned candidates"; log(`  SKIP: ${out.reason}`); continue; }
            plausible = [picked];
        }
        if (plausible.length === 0) {
            out.reason = "no plausible match";
            log(`  SKIP: ${out.reason}. Returned ${results.length} result(s):`);
            results.slice(0, 5).forEach((p) => log(`    · ${describe(p)}`));
            continue;
        }
        if (plausible.length > 1) {
            out.reason = "more than one plausible match";
            log(`  SKIP: ${out.reason}. Candidates (set "pick" to a place_id to choose):`);
            plausible.forEach((p) => log(`    · ${describe(p)}`));
            continue;
        }

        const p = plausible[0];
        log(`  Found: ${describe(p)}`);
        const existing = await prisma.location.findUnique({ where: { googlePlaceId: p.place_id }, select: { id: true } });
        if (existing) { out.reason = "googlePlaceId already exists"; log(`  SKIP: ${out.reason}`); continue; }

        if (!apply) { out.action = "would-insert"; log("  Dry run: would insert (no scores, no description)."); continue; }
        await prisma.location.create({
            data: {
                googlePlaceId: p.place_id,
                name: p.name,
                category: row.category,
                address: p.formatted_address ?? null,
                latitude: p.geometry.location.lat,
                longitude: p.geometry.location.lng,
            },
        });
        out.action = "inserted";
        log("  Inserted.");
    }
    const count = (a) => outcomes.filter((o) => o.action === a).length;
    const summary = { inserted: count("inserted"), wouldInsert: count("would-insert"), skipped: count("skip") };
    log(`\nDone${apply ? "" : " (dry run, nothing written)"}: inserted ${summary.inserted}, would insert ${summary.wouldInsert}, skipped ${summary.skipped}`);
    return { summary, outcomes };
}

async function main() {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith("--"));
    if (!file) { console.error("Usage: node scripts/add_extra_places.js <rows.json> [--apply] [--allow-remote-db]"); process.exit(1); }
    assertLocalDb(process.env.DATABASE_URL, { allowRemote: args.includes("--allow-remote-db") });
    const key = process.env.GOOGLE_PLACES_KEY;
    if (!key) { console.error("GOOGLE_PLACES_KEY is not set."); process.exit(1); }
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    const { default: prisma } = await import("../src/lib/prisma.js");
    try {
        await processRows(rows, { key, prisma, apply: args.includes("--apply") });
    } finally {
        await prisma.$disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error(String(err.message)); process.exit(1); });
}
