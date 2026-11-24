// !!! INTEGRATION TEST: NEEDS A THROWAWAY LOCAL POSTGRES !!!
//  - Refuses to run unless DATABASE_URL's host is localhost / 127.0.0.1.
//  - It creates its own rows (ids start "mdp-") and removes ONLY those rows afterwards; it does not wipe other tables.
//  - Run with the other DB tests: `npm run test:db` (--test-concurrency=1).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const url = process.env.DATABASE_URL || "";
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(url)) {
    console.error("Refusing to run: DATABASE_URL must point at a local throwaway database.");
    process.exit(1);
}
const { default: prisma } = await import("../src/lib/prisma.js");
const { mergeDuplicatePlaces } = await import("../scripts/merge_duplicate_places.js");

const quiet = () => { const logs = []; return { logs, log: (...a) => logs.push(a.join(" ")) }; };
const loc = (id, extra = {}) => prisma.location.create({ data: { id: `mdp-${id}`, name: `Place ${id}`, latitude: 43.7, longitude: -79.4, ...extra } });
const exists = async (id) => (await prisma.location.findUnique({ where: { id: `mdp-${id}` } })) != null;
const scoreRow = (id, reviewCount = 0) => prisma.sensoryScore.create({ data: { locationId: `mdp-${id}`, noiseScore: 3, lightingScore: 3, crowdScore: 3, comfortScore: 3, reviewCount } });
const review = (id, userId, locationId) => prisma.review.create({ data: { id, userId, locationId: `mdp-${locationId}`, bodyText: "x", rating: 8, noiseLevel: 4, lightingLevel: 4, crowdLevel: 4 } });

let user, user2;
async function cleanup() {
    const ids = { startsWith: "mdp-" };
    await prisma.review.deleteMany({ where: { locationId: ids } });
    await prisma.savedPlace.deleteMany({ where: { locationId: ids } });
    await prisma.checkIn.deleteMany({ where: { locationId: ids } });
    await prisma.sensoryScore.deleteMany({ where: { locationId: ids } });
    await prisma.location.deleteMany({ where: { id: ids } });
}
before(async () => {
    await cleanup();
    user = await prisma.user.upsert({ where: { auth0Id: "mdp|1" }, update: {}, create: { auth0Id: "mdp|1", email: "mdp1@example.test" } });
    user2 = await prisma.user.upsert({ where: { auth0Id: "mdp|2" }, update: {}, create: { auth0Id: "mdp|2", email: "mdp2@example.test" } });
});
after(async () => {
    await cleanup();
    await prisma.user.deleteMany({ where: { auth0Id: { in: ["mdp|1", "mdp|2"] } } });
    await prisma.$disconnect();
});

test("dry run (default) changes nothing", async () => {
    await cleanup();
    await loc("k1", { description: null }); await loc("r1", { description: "from remove" }); await scoreRow("r1");
    const c = quiet();
    const { summary } = await mergeDuplicatePlaces(prisma, [{ keep: "mdp-k1", remove: "mdp-r1" }], { log: c.log });
    assert.deepEqual(summary, { merged: 0, wouldMerge: 1, refused: 0, skipped: 0, failed: 0 });
    assert.ok(await exists("r1"));
    assert.equal((await prisma.location.findUnique({ where: { id: "mdp-k1" } })).description, null);
    assert.ok(await prisma.sensoryScore.findUnique({ where: { locationId: "mdp-r1" } }));
    assert.match(c.logs.join("\n"), /DRY RUN/);
});

test("REFUSES to delete a row that has reviews: nothing changes, a warning is printed", async () => {
    await cleanup();
    await loc("k2"); await loc("r2", { description: "would be copied" }); await scoreRow("r2", 1);
    await review("mdp-rev1", user.id, "r2");
    const c = quiet();
    const { summary, results } = await mergeDuplicatePlaces(prisma, [{ keep: "mdp-k2", remove: "mdp-r2" }], { apply: true, log: c.log });
    assert.equal(summary.refused, 1);
    assert.equal(summary.merged, 0);
    assert.equal(results[0].status, "refused");
    assert.ok(await exists("r2"), "the remove row is still there");
    assert.ok(await prisma.sensoryScore.findUnique({ where: { locationId: "mdp-r2" } }), "its scores row is still there");
    assert.equal(await prisma.review.count({ where: { locationId: "mdp-r2" } }), 1, "the review is untouched");
    assert.equal((await prisma.location.findUnique({ where: { id: "mdp-k2" } })).description, null, "nothing was copied");
    assert.match(c.logs.join("\n"), /WARNING: REFUSED/);
    assert.match(c.logs.join("\n"), /1 review/);
});

test("also refuses for a saved place or a check-in alone", async () => {
    await cleanup();
    await loc("k3"); await loc("r3"); await loc("r3b");
    await prisma.savedPlace.create({ data: { userId: user.id, locationId: "mdp-r3" } });
    await prisma.checkIn.create({ data: { userId: user.id, locationId: "mdp-r3b" } });
    const { summary } = await mergeDuplicatePlaces(prisma, [{ keep: "mdp-k3", remove: "mdp-r3" }, { keep: "mdp-k3", remove: "mdp-r3b" }], { apply: true, log: quiet().log });
    assert.equal(summary.refused, 2);
    assert.ok(await exists("r3") && await exists("r3b"));
});

test("--apply with no children: copies only EMPTY fields (never overwrites), deletes the scores row and the remove row, prints counts", async () => {
    await cleanup();
    await loc("k4", { description: "keep's own", category: null, address: "", googlePlaceId: "osm_node_44" });
    await loc("r4", { description: "remove's", category: "cafe", address: "1 Main St", imageUrl: "http://img", googlePlaceId: "ChIJreal4", estimatedNoiseScore: 2, estimatedLightingScore: 3, estimatedCrowdScore: 2, dataSource: "estimated" });
    await scoreRow("r4");
    const c = quiet();
    const { summary, before, after } = await mergeDuplicatePlaces(prisma, [{ keep: "mdp-k4", remove: "mdp-r4" }], { apply: true, log: c.log });
    assert.equal(summary.merged, 1);
    assert.equal(await exists("r4"), false);
    assert.equal(await prisma.sensoryScore.findUnique({ where: { locationId: "mdp-r4" } }), null);
    const k = await prisma.location.findUnique({ where: { id: "mdp-k4" } });
    assert.equal(k.description, "keep's own", "not overwritten");
    assert.equal(k.category, "cafe");
    assert.equal(k.address, "1 Main St");
    assert.equal(k.imageUrl, "http://img");
    assert.equal(k.googlePlaceId, "ChIJreal4", "a placeholder osm_ id counts as empty");
    assert.equal(k.estimatedNoiseScore, 2);
    assert.equal(k.dataSource, "estimated");
    assert.equal(before.locations - after.locations, 1);
    assert.equal(before.sensoryScores - after.sensoryScores, 1);
    assert.match(c.logs.join("\n"), /Before: \{/);
    assert.match(c.logs.join("\n"), /After: /);
});

test("keep's real Google id and estimates are never overwritten by remove's", async () => {
    await cleanup();
    await loc("k5", { googlePlaceId: "ChIJkeep5", estimatedNoiseScore: 1, estimatedLightingScore: 1, estimatedCrowdScore: 1, dataSource: "estimated" });
    await loc("r5", { googlePlaceId: "ChIJother5", estimatedNoiseScore: 5, estimatedLightingScore: 5, estimatedCrowdScore: 5 });
    await mergeDuplicatePlaces(prisma, [{ keep: "mdp-k5", remove: "mdp-r5" }], { apply: true, log: quiet().log });
    const k = await prisma.location.findUnique({ where: { id: "mdp-k5" } });
    assert.equal(k.googlePlaceId, "ChIJkeep5");
    assert.equal(k.estimatedNoiseScore, 1);
    assert.equal(await exists("r5"), false);
});

test("--move-children moves reviews, check-ins and saved places to keep (dropping a saved place the user already has there) and recalculates", async () => {
    await cleanup();
    await loc("k6"); await loc("r6"); await scoreRow("r6", 1);
    await review("mdp-rev6", user.id, "r6");
    await prisma.checkIn.create({ data: { userId: user.id, locationId: "mdp-r6" } });
    await prisma.savedPlace.create({ data: { userId: user.id, locationId: "mdp-r6" } });
    await prisma.savedPlace.create({ data: { userId: user2.id, locationId: "mdp-r6" } });
    await prisma.savedPlace.create({ data: { userId: user2.id, locationId: "mdp-k6" } });   // user2 already saved keep
    const recalcs = [];
    const c = quiet();
    const { summary } = await mergeDuplicatePlaces(prisma, [{ keep: "mdp-k6", remove: "mdp-r6" }], { apply: true, moveChildren: true, log: c.log, recalculate: async (id) => { recalcs.push(id); } });
    assert.equal(summary.merged, 1);
    assert.equal(await exists("r6"), false);
    assert.equal(await prisma.review.count({ where: { locationId: "mdp-k6" } }), 1);
    assert.equal(await prisma.checkIn.count({ where: { locationId: "mdp-k6" } }), 1);
    assert.equal(await prisma.savedPlace.count({ where: { locationId: "mdp-k6" } }), 2);   // user (moved) + user2 (kept; duplicate dropped)
    assert.deepEqual(recalcs, ["mdp-k6"]);
    assert.match(c.logs.join("\n"), /MOVED to keep: 1 review\(s\), 1 saved place\(s\), 1 check-in\(s\); 1 duplicate/);
});

test("one transaction: if the final step fails, nothing from that pair is changed", async () => {
    await cleanup();
    await loc("k7"); await loc("r7", { description: "x" }); await scoreRow("r7");
    // keep's googlePlaceId copy collides with a third row's unique id, so the LAST write in the transaction throws
    await loc("other7", { googlePlaceId: "ChIJcollide" });
    await prisma.location.update({ where: { id: "mdp-r7" }, data: { googlePlaceId: "ChIJcollide-r" } });
    const real = prisma.$transaction.bind(prisma);
    const failing = { ...prisma, location: prisma.location, sensoryScore: prisma.sensoryScore, review: prisma.review, savedPlace: prisma.savedPlace, checkIn: prisma.checkIn,
        $transaction: (fn) => real(async (tx) => fn(new Proxy(tx, { get: (t, k) => (k === "location" ? new Proxy(t.location, { get: (l, m) => (m === "update" ? async () => { throw new Error("boom"); } : l[m]) }) : t[k]) }))) };
    const c = quiet();
    const { summary } = await mergeDuplicatePlaces(failing, [{ keep: "mdp-k7", remove: "mdp-r7" }], { apply: true, log: c.log });
    assert.equal(summary.failed, 1);
    assert.ok(await exists("r7"), "the delete was rolled back");
    assert.ok(await prisma.sensoryScore.findUnique({ where: { locationId: "mdp-r7" } }), "the scores delete was rolled back");
    assert.match(c.logs.join("\n"), /rolled back/);
});

test("missing ids and bad pairs are skipped, not fatal; the good pair still runs", async () => {
    await cleanup();
    await loc("k8"); await loc("r8");
    const { summary } = await mergeDuplicatePlaces(prisma, [{ keep: "mdp-k8", remove: "mdp-nope" }, { keep: "mdp-z9", remove: "mdp-z9" }, { keep: "mdp-k8", remove: "mdp-r8" }], { apply: true, log: quiet().log });
    assert.deepEqual([summary.merged, summary.skipped], [1, 2]);
    assert.equal(await exists("r8"), false);
    assert.ok(await exists("k8"));
});
