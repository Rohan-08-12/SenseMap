/**
 * DESTRUCTIVE: deletes every Location outside the Toronto-area box below, plus its reviews, scores,
 * saved places and check-ins. Out-of-Toronto places added on purpose (Milton, Brampton, ...) match too.
 *
 * Without --confirm it only reports: the row count and the first 20 names, then exits without deleting.
 *   node cleanup_non_toronto.js            # report only
 *   node cleanup_non_toronto.js --confirm  # delete
 */

// Toronto bounding box
export const BOUNDS = {
    latMin: 43.4,
    latMax: 43.9,
    lngMin: -79.75,
    lngMax: -79.0,
};

const PREVIEW_COUNT = 20;

/** Returns { deleted, exitCode }. Deletes only when confirm is true. */
export async function run(prisma, { confirm = false, log = console.log } = {}) {
    const outside = await prisma.location.findMany({
        where: {
            OR: [
                { latitude: { lt: BOUNDS.latMin } },
                { latitude: { gt: BOUNDS.latMax } },
                { longitude: { lt: BOUNDS.lngMin } },
                { longitude: { gt: BOUNDS.lngMax } },
            ],
        },
        select: { id: true, name: true, latitude: true, longitude: true },
    });

    log(`Found ${outside.length} locations outside Toronto:`);
    outside.slice(0, PREVIEW_COUNT).forEach(l => log(`  - ${l.name} (${l.latitude}, ${l.longitude})`));
    if (outside.length > PREVIEW_COUNT) log(`  ... and ${outside.length - PREVIEW_COUNT} more`);

    if (outside.length === 0) {
        log("Nothing to delete.");
        return { deleted: 0, exitCode: 0 };
    }

    if (!confirm) {
        log(`\nNothing deleted. This would delete ${outside.length} locations and their reviews, scores, saved places and check-ins.`);
        log("Re-run with --confirm to delete them.");
        return { deleted: 0, exitCode: 1 };
    }

    const ids = outside.map(l => l.id);

    // Delete dependent records first
    await prisma.review.deleteMany({ where: { locationId: { in: ids } } });
    await prisma.sensoryScore.deleteMany({ where: { locationId: { in: ids } } });
    await prisma.savedPlace.deleteMany({ where: { locationId: { in: ids } } });
    await prisma.checkIn.deleteMany({ where: { locationId: { in: ids } } });

    const { count } = await prisma.location.deleteMany({
        where: { id: { in: ids } },
    });

    log(`\nDeleted ${count} locations.`);
    return { deleted: count, exitCode: 0 };
}

async function main() {
    const { default: prisma } = await import("./src/lib/prisma.js");
    try {
        const { exitCode } = await run(prisma, { confirm: process.argv.includes("--confirm") });
        await prisma.$disconnect();
        process.exit(exitCode);
    } catch (e) {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
