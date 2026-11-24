/**
 * READ-ONLY: how many places the "trustworthy scores" rule changes. No write code.
 * For every Location it works out what the app used to do and what it does now, and prints the counts and the names of
 * the places that change. Refuses to run unless DATABASE_URL is localhost / 127.0.0.1 (pass --allow-remote-db to run this
 * read-only report against another database on purpose).
 *
 *   node scripts/trust_rule_report.js [--names 40] [--allow-remote-db]
 */
import "dotenv/config";
import { displayScoreForLocation } from "../src/lib/scores.js";
import { hasTrustworthyScores } from "../src/lib/trustworthyScores.js";

export function assertLocalDb(url, { allowRemote = false } = {}) {
    if (allowRemote) return;
    let host = "";
    try { host = new URL(url).hostname; } catch { /* handled below */ }
    if (host !== "localhost" && host !== "127.0.0.1") throw new Error("Refusing to run: DATABASE_URL must point at localhost / 127.0.0.1 (pass --allow-remote-db to run this read-only report elsewhere).");
}

/** What GET /rankings and /locations/heatmap did before the rule: a place appeared when it had any noise number (0 counted as missing). */
export function wasRankedBefore(loc) {
    const s = loc.sensoryScores;
    const noise = (s?.reviewCount > 0 ? s?.noiseScore : null) || loc.estimatedNoiseScore || s?.noiseScore;
    return noise != null;
}
/** What the search/list GeoJSON showed before: any score number from the SensoryScore row or the estimate (null shown as 0.0 by the client). */
export const showedNumbersInSearchBefore = (loc) => (loc.sensoryScores?.noiseScore ?? loc.estimatedNoiseScore ?? null) != null;

export function bucket(loc) {
    const d = displayScoreForLocation(loc);
    if (d.source === "community") return hasTrustworthyScores(d, loc.enrichmentConfidence) ? "community (trusted)" : "community but a score is missing";
    if (d.source === "estimated") {
        if (d.noise <= 0.5 && d.lighting <= 0.5 && d.crowd <= 0.5) return "AI estimate, all at the 0.5 floor";
        if (typeof loc.enrichmentConfidence === "number" && loc.enrichmentConfidence < 4) return "AI estimate, recorded confidence < 4";
        return hasTrustworthyScores(d, loc.enrichmentConfidence) ? "AI estimate (trusted)" : "AI estimate (invalid numbers)";
    }
    return loc.sensoryScores ? "category default scores only (reviewCount 0)" : "no scores at all";
}

export async function report(prisma, { names = 40, log = console.log } = {}) {
    const rows = await prisma.location.findMany({
        select: { id: true, name: true, category: true, estimatedNoiseScore: true, estimatedLightingScore: true, estimatedCrowdScore: true, enrichmentConfidence: true,
            sensoryScores: { select: { noiseScore: true, lightingScore: true, crowdScore: true, comfortScore: true, reviewCount: true } } },
    });
    const buckets = {}, changed = { rankings: [], search: [] };
    for (const r of rows) {
        const b = bucket(r);
        buckets[b] = (buckets[b] ?? 0) + 1;
        const now = hasTrustworthyScores(displayScoreForLocation(r), r.enrichmentConfidence);
        if (wasRankedBefore(r) && !now) changed.rankings.push(r.name);
        if (showedNumbersInSearchBefore(r) && !now) changed.search.push(r.name);
    }
    const trusted = rows.filter((r) => hasTrustworthyScores(displayScoreForLocation(r), r.enrichmentConfidence)).length;
    log(`${rows.length} places. Trustworthy under the rule: ${trusted}. Not trustworthy: ${rows.length - trusted}.`);
    log(`\nBy kind:`);
    Object.entries(buckets).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => log(`  ${String(n).padStart(5)}  ${k}`));
    const before = rows.filter(wasRankedBefore).length;
    log(`\nRankings and heatmap: ${before} places before, ${trusted} now (${changed.rankings.length} removed).`);
    log(`Search results and cards that used to show numbers (possibly 0.0) but now say "Not enough data yet": ${changed.search.length}.`);
    const list = (label, arr) => { if (arr.length) { log(`\n${label} (${arr.length}${arr.length > names ? `, first ${names}` : ""}):`); arr.slice(0, names).forEach((n) => log(`  - ${n}`)); } };
    list("Removed from rankings/heatmap", changed.rankings);
    return { total: rows.length, trusted, buckets, removedFromRankings: changed.rankings.length, noLongerShownInSearch: changed.search.length };
}

async function main() {
    const args = process.argv.slice(2);
    assertLocalDb(process.env.DATABASE_URL, { allowRemote: args.includes("--allow-remote-db") });
    const i = args.indexOf("--names");
    const { default: prisma } = await import("../src/lib/prisma.js");
    try { await report(prisma, { names: i >= 0 ? Number(args[i + 1]) : 40 }); } finally { await prisma.$disconnect(); }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(String(e.message)); process.exit(1); });
