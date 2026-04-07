import prisma from "./prisma.js";

/**
 * Recalculates the aggregated sensory scores for a specific location.
 * This is called automatically whenever a new review is submitted.
 * It averages the noise, lighting, crowd, and overall comfort ratings.
 */
export const recalculateScores = async (locationId) => {
    const reviews = await prisma.review.findMany({
        where: { locationId }
    });

    if (reviews.length === 0) return;

    const avg = (field) => {
        const values = reviews.map(r => r[field]).filter(v => v !== null);
        if (values.length === 0) return null;
        return values.reduce((a, b) => a + b, 0) / values.length;
    };

    const noiseScore = avg("noiseLevel");
    const lightingScore = avg("lightingLevel");
    const crowdScore = avg("crowdLevel");
    const comfortScore = avg("rating");

    await prisma.sensoryScore.upsert({
        where: { locationId },
        update: {
            noiseScore,
            lightingScore,
            crowdScore,
            comfortScore,
            reviewCount: reviews.length,
        },
        create: {
            locationId,
            noiseScore,
            lightingScore,
            crowdScore,
            comfortScore,
            reviewCount: reviews.length,
        }
    });
};