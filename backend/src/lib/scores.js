import prisma from "./prisma.js";

/**
 * Recalculates the aggregated sensory scores for a specific location.
 * Called after every new review. Raw slider values are 1-10; dividing by 2
 * normalises them to the 1-5 scale used everywhere else (AI insights, match
 * calculation, display labels).
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

    // Slider values are 1-10; divide by 2 to store on the 1-5 scale
    const noiseScore    = avg("noiseLevel")    != null ? avg("noiseLevel")    / 2 : null;
    const lightingScore = avg("lightingLevel") != null ? avg("lightingLevel") / 2 : null;
    const crowdScore    = avg("crowdLevel")    != null ? avg("crowdLevel")    / 2 : null;
    // Rating slider is also 1-10 (overall comfort); normalise to 1-5
    const comfortScore  = avg("rating")        != null ? avg("rating")        / 2 : null;

    await prisma.sensoryScore.upsert({
        where: { locationId },
        update: { noiseScore, lightingScore, crowdScore, comfortScore, reviewCount: reviews.length },
        create: { locationId, noiseScore, lightingScore, crowdScore, comfortScore, reviewCount: reviews.length },
    });
};
