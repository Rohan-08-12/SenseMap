import prisma from "./src/lib/prisma.js";

// Toronto bounding box
const BOUNDS = {
    latMin: 43.4,
    latMax: 43.9,
    lngMin: -79.75,
    lngMax: -79.0,
};

async function main() {
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

    console.log(`Found ${outside.length} locations outside Toronto:`);
    outside.forEach(l => console.log(`  - ${l.name} (${l.latitude}, ${l.longitude})`));

    if (outside.length === 0) {
        console.log("Nothing to delete.");
        await prisma.$disconnect();
        return;
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

    console.log(`\nDeleted ${count} locations.`);
    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
