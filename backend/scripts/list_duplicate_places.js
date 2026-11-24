/**
 * READ-ONLY report of likely duplicate places. It has no delete, update, create or upsert code at all.
 *
 * A "likely duplicate group" is two or more Location rows whose names match (same normalised name, or one contains
 * the other, the same test /discover uses) and that sit within 100 m of each other. For each row it prints the id,
 * name, address, category, googlePlaceId, and whether it has scores, reviews, saved places and check-ins, so you can
 * decide by hand which to keep. Nothing is merged or removed.
 *
 *   node scripts/list_duplicate_places.js                       # local database only
 *   node scripts/list_duplicate_places.js --allow-remote-db     # explicitly allow a non-localhost DATABASE_URL (read-only)
 *   node scripts/list_duplicate_places.js --radius 150          # metres (default 100)
 *
 * Refuses to run unless DATABASE_URL's host is localhost / 127.0.0.1, unless --allow-remote-db is passed.
 */
import "dotenv/config";
import { haversineMetres } from "../src/lib/geo.js";

export const DEFAULT_RADIUS_M = 100;

export function assertLocalDb(url, { allowRemote = false } = {}) {
    if (allowRemote) return;
    let host = "";
    try { host = new URL(url).hostname; } catch { /* handled below */ }
    if (host !== "localhost" && host !== "127.0.0.1") {
        throw new Error("Refusing to run: DATABASE_URL must point at localhost / 127.0.0.1 (pass --allow-remote-db to run this read-only report elsewhere).");
    }
}

export const normalizeName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const namesLikelyMatch = (a, b) => {
    const na = normalizeName(a), nb = normalizeName(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
};

/** Pure: groups rows ({ id, name, latitude, longitude }) whose names match and that are within radiusM. Groups of 2+ only. */
export function findDuplicateGroups(rows, radiusM = DEFAULT_RADIUS_M) {
    const parent = rows.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const cell = 0.002; // ~200 m grid so the comparison is not O(n^2) over every pair
    const grid = new Map();
    rows.forEach((r, i) => {
        const key = `${Math.floor(r.latitude / cell)}:${Math.floor(r.longitude / cell)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    });
    rows.forEach((r, i) => {
        const gy = Math.floor(r.latitude / cell), gx = Math.floor(r.longitude / cell);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            for (const j of grid.get(`${gy + dy}:${gx + dx}`) ?? []) {
                if (j <= i) continue;
                const o = rows[j];
                if (namesLikelyMatch(r.name, o.name) && haversineMetres(r.latitude, r.longitude, o.latitude, o.longitude) <= radiusM) {
                    parent[find(j)] = find(i);
                }
            }
        }
    });
    const groups = new Map();
    rows.forEach((r, i) => {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(r);
    });
    return [...groups.values()].filter((g) => g.length > 1);
}

const yn = (b) => (b ? "yes" : "no");

export function describeRow(r) {
    const s = r.sensoryScores;
    const scored = s ? `scores row (reviewCount ${s.reviewCount})` : r.estimatedNoiseScore != null ? "AI estimate only" : "no scores";
    return `    ${r.id} | ${r.name} | ${r.address ?? "no address"} | category=${r.category ?? "-"} | place id=${r.googlePlaceId ?? "-"}\n` +
        `      ${scored}; reviews: ${r._count.reviews}; saved by: ${r._count.savedBy}; check-ins: ${r._count.checkIns}; has image: ${yn(r.imageUrl)}`;
}

export async function report(prisma, { radiusM = DEFAULT_RADIUS_M, log = console.log } = {}) {
    const rows = await prisma.location.findMany({
        select: {
            id: true, name: true, address: true, category: true, googlePlaceId: true, imageUrl: true,
            latitude: true, longitude: true, estimatedNoiseScore: true,
            sensoryScores: { select: { reviewCount: true } },
            _count: { select: { reviews: true, savedBy: true, checkIns: true } },
        },
    });
    const groups = findDuplicateGroups(rows, radiusM).sort((a, b) => b.length - a.length);
    log(`${rows.length} places checked, ${groups.length} likely duplicate group(s) within ${radiusM} m (read-only, nothing changed):`);
    groups.forEach((g, i) => {
        log(`\nGroup ${i + 1}: ${g.length} rows`);
        g.forEach((r) => log(describeRow(r)));
    });
    return groups;
}

async function main() {
    const args = process.argv.slice(2);
    assertLocalDb(process.env.DATABASE_URL, { allowRemote: args.includes("--allow-remote-db") });
    const i = args.indexOf("--radius");
    const radiusM = i >= 0 ? Number(args[i + 1]) : DEFAULT_RADIUS_M;
    if (!Number.isFinite(radiusM) || radiusM <= 0) throw new Error("--radius must be a positive number of metres");
    const { default: prisma } = await import("../src/lib/prisma.js");
    try { await report(prisma, { radiusM }); } finally { await prisma.$disconnect(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error(String(err.message)); process.exit(1); });
}
