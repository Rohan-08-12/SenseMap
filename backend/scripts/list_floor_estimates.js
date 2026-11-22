/**
 * READ-ONLY. Lists places whose three estimated scores are all <= 0.5 (the 1/10 floor), so they can
 * be reviewed before anything is re-enriched. It only runs SELECTs; it never writes, never calls
 * Gemini or any other API.
 *
 *   node scripts/list_floor_estimates.js                 # table of affected places
 *   node scripts/list_floor_estimates.js --out ids.json  # also write the id list to a file
 *   node scripts/list_floor_estimates.js --no-reviews    # only places with no community reviews
 *
 * The connection comes from DATABASE_URL (loaded by src/lib/prisma.js); only the host is printed.
 *
 * HOW A LIMITED RE-ENRICHMENT WOULD BE TRIGGERED (not done by this script): review ids.json, keep
 * the first N, then call the existing per-place n8n endpoint once per id with a pause, e.g.
 *   for id in $(jq -r '.[:25][]' ids.json); do
 *     curl -s -X POST "$API/enrichment/location" -H "x-n8n-secret: $N8N_WEBHOOK_SECRET" \
 *          -H "content-type: application/json" -d "{\"locationId\":\"$id\"}"; sleep 3; done
 * Each call makes one Gemini request (paid). With the validation/confidence gate in place, a place
 * with no real signal is NOT overwritten: its old 0.5 estimates stay (only enrichmentConfidence and
 * lastEnrichedAt change), so clearing the bad estimates is a separate, reviewed step.
 */
import fs from "node:fs";
import prisma from "../src/lib/prisma.js";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const noReviews = args.includes("--no-reviews");

try {
    const host = (() => { try { return new URL(process.env.DATABASE_URL).host; } catch { return "(unparseable DATABASE_URL)"; } })();
    console.log(`Reading from ${host} (read-only)\n`);

    const places = await prisma.location.findMany({
        where: {
            estimatedNoiseScore:    { lte: 0.5 },
            estimatedLightingScore: { lte: 0.5 },
            estimatedCrowdScore:    { lte: 0.5 },
            ...(noReviews && { OR: [{ sensoryScores: null }, { sensoryScores: { reviewCount: 0 } }] }),
        },
        select: {
            id: true, name: true, address: true, dataSource: true, enrichmentConfidence: true,
            lastEnrichedAt: true, sensoryScores: { select: { reviewCount: true } },
        },
        orderBy: { name: "asc" },
    });

    console.table(places.map((p) => ({
        id: p.id, name: p.name?.slice(0, 36), address: p.address?.slice(0, 30), dataSource: p.dataSource,
        confidence: p.enrichmentConfidence ?? "—", reviews: p.sensoryScores?.reviewCount ?? 0,
        enriched: p.lastEnrichedAt?.toISOString().slice(0, 10) ?? "never",
    })));
    console.log(`${places.length} place(s) with all three estimates <= 0.5`);

    // Partial-floor and NaN checks (raw SELECTs; Prisma's filters can't express NaN).
    const [partial, nan] = await Promise.all([
        prisma.$queryRaw`SELECT n_floor::int AS factors_at_floor, COUNT(*)::int AS places FROM (
            SELECT (("estimatedNoiseScore" = 0.5)::int + ("estimatedLightingScore" = 0.5)::int + ("estimatedCrowdScore" = 0.5)::int) AS n_floor
            FROM "Location"
            WHERE "estimatedNoiseScore" IS NOT NULL AND "estimatedLightingScore" IS NOT NULL AND "estimatedCrowdScore" IS NOT NULL) t
          WHERE n_floor BETWEEN 1 AND 3 GROUP BY n_floor ORDER BY n_floor`,
        prisma.$queryRaw`SELECT COUNT(*)::int AS places FROM "Location"
          WHERE "estimatedNoiseScore" = 'NaN'::float8 OR "estimatedLightingScore" = 'NaN'::float8 OR "estimatedCrowdScore" = 'NaN'::float8`,
    ]);
    console.log("\nPlaces by number of factors exactly at 0.5:");
    console.table(partial);
    console.log(`Places with a NaN estimate: ${nan[0].places}`);

    if (outFile) {
        fs.writeFileSync(outFile, JSON.stringify(places.map((p) => p.id), null, 2));
        console.log(`\nWrote ${places.length} ids to ${outFile}`);
    }
} finally {
    await prisma.$disconnect();
}
