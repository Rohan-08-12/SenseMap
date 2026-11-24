/**
 * One-off cleanup: remove duplicate Location rows you have already chosen, given a JSON list of { keep, remove } ids.
 * The list is YOURS: this script never looks for duplicates and never generates pairs (use list_duplicate_places.js to look).
 *
 *   node scripts/merge_duplicate_places.js pairs.json                      # DRY RUN (default): reads only, prints the plan
 *   node scripts/merge_duplicate_places.js pairs.json --apply              # do it
 *   node scripts/merge_duplicate_places.js pairs.json --apply --move-children
 *   node scripts/merge_duplicate_places.js pairs.json --apply --allow-remote-db   # a non-localhost DATABASE_URL, on purpose
 *
 * pairs.json:  [ { "keep": "<location id>", "remove": "<location id>" }, ... ]
 *
 * RULES (per pair, ONE TRANSACTION: all of it happens or none of it)
 *  1. If the "remove" row has any reviews, saved places or check-ins, the pair is REFUSED: a warning with the counts is
 *     printed, and nothing is changed or deleted. (We expect none.) Pass --move-children to MOVE them to "keep" instead
 *     (reviews and check-ins are re-pointed; a saved place is re-pointed unless that user already saved "keep", in which
 *     case the duplicate saved-place row is dropped); the script says so, and recalculates "keep"'s scores afterwards.
 *  2. Useful fields are copied from "remove" to "keep" ONLY where "keep"'s value is empty (null or ""); nothing on "keep"
 *     is ever overwritten. Fields: description, category, address, imageUrl, audioUrl (+audioGeneratedAt), externalYelpId,
 *     googlePlaceId (empty also covers a placeholder "osm_*" id, which is not a real Google id), and the enrichment block
 *     (estimated noise/lighting/crowd, estimatedFacilities, dataSource, lastEnrichedAt, enrichmentConfidence) only when
 *     "keep" has no estimated score at all. The embedding is not copied.
 *  3. Then the "remove" row's SensoryScore row and the "remove" Location row are deleted.
 *  Counts of every affected table are printed before and after.
 *
 * Refuses to run unless DATABASE_URL's host is localhost / 127.0.0.1, unless --allow-remote-db is given.
 * A pair is skipped (not failed) when: an id is missing in the table, keep === remove, a "remove" id appears in more than
 * one pair, or an id is used as "keep" in one pair and "remove" in another. (Several removes may share one keep.)
 */
import "dotenv/config";
import fs from "node:fs";

export function assertLocalDb(url, { allowRemote = false } = {}) {
    if (allowRemote) return;
    let host = "";
    try { host = new URL(url).hostname; } catch { /* handled below */ }
    if (host !== "localhost" && host !== "127.0.0.1") {
        throw new Error("Refusing to run: DATABASE_URL must point at localhost / 127.0.0.1 (pass --allow-remote-db to override on purpose).");
    }
}

const isEmpty = (v) => v == null || v === "";
const isPlaceholderPlaceId = (v) => isEmpty(v) || String(v).startsWith("osm_");
const SIMPLE_FIELDS = ["description", "category", "address", "imageUrl", "externalYelpId"];
const ENRICH_FIELDS = ["estimatedNoiseScore", "estimatedLightingScore", "estimatedCrowdScore", "estimatedFacilities", "dataSource", "lastEnrichedAt", "enrichmentConfidence"];

/** Pure: structural problems with the input list. Returns an array of { index, problem }. */
export function validatePairs(pairs) {
    if (!Array.isArray(pairs)) return [{ index: -1, problem: "input must be a JSON array of { keep, remove }" }];
    const problems = [];
    const use = new Map(); // id -> { keep: n, remove: n }
    const note = (id, role) => { const u = use.get(id) ?? { keep: 0, remove: 0 }; u[role]++; use.set(id, u); };
    pairs.forEach((p, index) => {
        if (!p || typeof p.keep !== "string" || typeof p.remove !== "string" || !p.keep || !p.remove) {
            problems.push({ index, problem: "needs string keep and remove ids" });
            return;
        }
        if (p.keep === p.remove) problems.push({ index, problem: "keep and remove are the same id" });
        note(p.keep, "keep"); note(p.remove, "remove");
    });
    pairs.forEach((p, index) => {
        if (!p || !p.keep || !p.remove) return;
        const k = use.get(p.keep), r = use.get(p.remove);
        if (k.remove > 0) problems.push({ index, problem: `keep ${p.keep} is also used as a remove in another pair` });
        if (r.remove > 1 || r.keep > 0) problems.push({ index, problem: `remove ${p.remove} appears in more than one pair or is also used as a keep` });
    });
    return problems;
}

/** Reads one pair (works on prisma or a transaction client). Writes nothing. */
export async function planPair(db, pair) {
    const plan = { pair, ok: false, problems: [], keep: null, remove: null, children: { reviews: 0, savedPlaces: 0, checkIns: 0 }, savedConflicts: 0, removeScore: null, copies: {} };
    const [keep, remove] = await Promise.all([
        db.location.findUnique({ where: { id: pair.keep } }),
        db.location.findUnique({ where: { id: pair.remove } }),
    ]);
    if (!keep) plan.problems.push(`keep id ${pair.keep} not found`);
    if (!remove) plan.problems.push(`remove id ${pair.remove} not found`);
    if (!keep || !remove) return plan;
    plan.keep = keep; plan.remove = remove;

    const [reviews, savedPlaces, checkIns, removeScore] = await Promise.all([
        db.review.count({ where: { locationId: remove.id } }),
        db.savedPlace.count({ where: { locationId: remove.id } }),
        db.checkIn.count({ where: { locationId: remove.id } }),
        db.sensoryScore.findUnique({ where: { locationId: remove.id } }),
    ]);
    plan.children = { reviews, savedPlaces, checkIns };
    plan.removeScore = removeScore;
    if (savedPlaces > 0) {
        const mine = await db.savedPlace.findMany({ where: { locationId: remove.id }, select: { userId: true } });
        const onKeep = await db.savedPlace.findMany({ where: { locationId: keep.id, userId: { in: mine.map((m) => m.userId) } }, select: { userId: true } });
        plan.savedConflicts = onKeep.length;
    }

    for (const f of SIMPLE_FIELDS) if (isEmpty(keep[f]) && !isEmpty(remove[f])) plan.copies[f] = remove[f];
    if (isEmpty(keep.audioUrl) && !isEmpty(remove.audioUrl)) { plan.copies.audioUrl = remove.audioUrl; plan.copies.audioGeneratedAt = remove.audioGeneratedAt; }
    if (isPlaceholderPlaceId(keep.googlePlaceId) && !isEmpty(remove.googlePlaceId) && !String(remove.googlePlaceId).startsWith("osm_") && keep.googlePlaceId !== remove.googlePlaceId) {
        plan.copies.googlePlaceId = remove.googlePlaceId;
    }
    const keepHasEstimates = keep.estimatedNoiseScore != null || keep.estimatedLightingScore != null || keep.estimatedCrowdScore != null;
    const removeHasEstimates = remove.estimatedNoiseScore != null || remove.estimatedLightingScore != null || remove.estimatedCrowdScore != null;
    if (!keepHasEstimates && removeHasEstimates) for (const f of ENRICH_FIELDS) if (remove[f] != null) plan.copies[f] = remove[f];

    plan.ok = true;
    return plan;
}

async function tableCounts(prisma) {
    const [locations, sensoryScores, reviews, savedPlaces, checkIns] = await Promise.all([
        prisma.location.count(), prisma.sensoryScore.count(), prisma.review.count(), prisma.savedPlace.count(), prisma.checkIn.count(),
    ]);
    return { locations, sensoryScores, reviews, savedPlaces, checkIns };
}

const childrenTotal = (c) => c.reviews + c.savedPlaces + c.checkIns;
const label = (l) => `"${l.name}" (${l.id}, googlePlaceId ${l.googlePlaceId ?? "none"})`;

function describePlan(plan, { moveChildren }, log) {
    log(`\n— keep ${label(plan.keep)}\n  remove ${label(plan.remove)}`);
    const c = plan.children;
    if (childrenTotal(c) > 0) {
        log(`  The remove row has ${c.reviews} review(s), ${c.savedPlaces} saved place(s), ${c.checkIns} check-in(s).`);
        if (moveChildren) log(`  --move-children: they will be MOVED to keep${plan.savedConflicts ? ` (${plan.savedConflicts} saved place(s) already on keep: the duplicate saved-place row is dropped)` : ""}.`);
    } else {
        log("  The remove row has no reviews, saved places or check-ins.");
    }
    const copies = Object.keys(plan.copies);
    log(copies.length ? `  Copy to keep (its value is empty): ${copies.join(", ")}` : "  Nothing to copy (keep has no empty field that remove fills).");
    log(`  Delete: ${plan.removeScore ? "its scores row, then " : "(no scores row), "}the remove Location row.`);
}

/**
 * @param prisma  PrismaClient (or a fake with the same calls)
 * @param pairs   [{ keep, remove }]
 * @param opts    { apply, moveChildren, log, recalculate(locationId) }
 */
export async function mergeDuplicatePlaces(prisma, pairs, { apply = false, moveChildren = false, log = console.log, recalculate = async () => {} } = {}) {
    const results = [];
    const structural = validatePairs(pairs);
    if (structural.some((p) => p.index === -1)) throw new Error(structural[0].problem);
    const bad = new Map();
    for (const p of structural) bad.set(p.index, [...(bad.get(p.index) ?? []), p.problem]);

    const before = await tableCounts(prisma);
    log(`${apply ? "APPLY" : "DRY RUN (nothing is written)"}: ${pairs.length} pair(s).`);
    log(`Before: ${JSON.stringify(before)}`);

    for (let index = 0; index < pairs.length; index++) {
        const pair = pairs[index];
        const res = { index, pair, status: "skipped", reason: "" };
        results.push(res);
        if (bad.has(index)) { res.reason = bad.get(index).join("; "); log(`\n— pair ${index + 1}: SKIPPED: ${res.reason}`); continue; }

        const plan = await planPair(prisma, pair);
        if (!plan.ok) { res.reason = plan.problems.join("; "); log(`\n— pair ${index + 1}: SKIPPED: ${res.reason}`); continue; }
        describePlan(plan, { moveChildren }, log);
        if (childrenTotal(plan.children) > 0 && !moveChildren) {
            res.status = "refused";
            res.reason = "remove row has reviews, saved places or check-ins";
            log(`  WARNING: REFUSED. Nothing was changed. Look at this pair again, or re-run with --move-children to move them to keep first.`);
            continue;
        }
        if (!apply) { res.status = "would-merge"; log("  Dry run: would merge (not applied)."); continue; }

        // One transaction per pair; everything is re-read inside it, so a row that changed since the plan is judged again.
        try {
            const outcome = await prisma.$transaction(async (tx) => {
                const p = await planPair(tx, pair);
                if (!p.ok) return { status: "skipped", reason: p.problems.join("; ") };
                if (childrenTotal(p.children) > 0 && !moveChildren) return { status: "refused", reason: "remove row has reviews, saved places or check-ins" };
                const moved = { reviews: 0, savedPlaces: 0, checkIns: 0, droppedSaved: 0 };
                if (childrenTotal(p.children) > 0) {
                    moved.reviews = (await tx.review.updateMany({ where: { locationId: p.remove.id }, data: { locationId: p.keep.id } })).count;
                    moved.checkIns = (await tx.checkIn.updateMany({ where: { locationId: p.remove.id }, data: { locationId: p.keep.id } })).count;
                    const mine = await tx.savedPlace.findMany({ where: { locationId: p.remove.id }, select: { id: true, userId: true } });
                    for (const s of mine) {
                        const dupe = await tx.savedPlace.findUnique({ where: { userId_locationId: { userId: s.userId, locationId: p.keep.id } } });
                        if (dupe) { await tx.savedPlace.delete({ where: { id: s.id } }); moved.droppedSaved++; }
                        else { await tx.savedPlace.update({ where: { id: s.id }, data: { locationId: p.keep.id } }); moved.savedPlaces++; }
                    }
                }
                await tx.sensoryScore.deleteMany({ where: { locationId: p.remove.id } });
                await tx.location.delete({ where: { id: p.remove.id } });
                // googlePlaceId is unique: it can only be copied once the remove row (which holds it) is gone.
                if (Object.keys(p.copies).length) await tx.location.update({ where: { id: p.keep.id }, data: p.copies });
                return { status: "merged", moved, copied: Object.keys(p.copies) };
            });
            Object.assign(res, outcome);
            if (outcome.status === "merged") {
                const m = outcome.moved;
                log(`  MERGED. Deleted remove row and its scores. Copied: ${outcome.copied.join(", ") || "nothing"}.`);
                if (m.reviews + m.savedPlaces + m.checkIns + m.droppedSaved > 0) {
                    log(`  MOVED to keep: ${m.reviews} review(s), ${m.savedPlaces} saved place(s), ${m.checkIns} check-in(s); ${m.droppedSaved} duplicate saved-place row(s) dropped.`);
                    if (m.reviews > 0) {
                        try { await recalculate(pair.keep); log("  Recalculated keep's scores."); }
                        catch (err) { log(`  WARNING: could not recalculate keep's scores (${String(err.message)}); they update on the next review.`); }
                    }
                }
            } else {
                log(`  ${outcome.status.toUpperCase()}: ${outcome.reason}. Nothing was changed.`);
            }
        } catch (err) {
            res.status = "failed"; res.reason = String(err.message);
            log(`  FAILED and rolled back: ${res.reason}`);
        }
    }

    const after = await tableCounts(prisma);
    log(`\nAfter:  ${JSON.stringify(after)}`);
    const n = (s) => results.filter((r) => r.status === s).length;
    const summary = { merged: n("merged"), wouldMerge: n("would-merge"), refused: n("refused"), skipped: n("skipped"), failed: n("failed") };
    log(`Done${apply ? "" : " (dry run)"}: merged ${summary.merged}, would merge ${summary.wouldMerge}, refused ${summary.refused}, skipped ${summary.skipped}, failed ${summary.failed}`);
    return { summary, results, before, after };
}

async function main() {
    const args = process.argv.slice(2);
    const file = args.find((a) => !a.startsWith("--"));
    if (!file) { console.error("Usage: node scripts/merge_duplicate_places.js <pairs.json> [--apply] [--move-children] [--allow-remote-db]"); process.exit(1); }
    assertLocalDb(process.env.DATABASE_URL, { allowRemote: args.includes("--allow-remote-db") });
    const pairs = JSON.parse(fs.readFileSync(file, "utf8"));
    const { default: prisma } = await import("../src/lib/prisma.js");
    const { recalculateScores } = await import("../src/lib/scores.js");
    try {
        const { summary } = await mergeDuplicatePlaces(prisma, pairs, { apply: args.includes("--apply"), moveChildren: args.includes("--move-children"), recalculate: recalculateScores });
        if (summary.failed > 0 || summary.refused > 0) process.exitCode = 2;
    } finally {
        await prisma.$disconnect();
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((err) => { console.error(String(err.message)); process.exit(1); });
}
