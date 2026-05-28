import prisma from "./prisma.js";

// Review weight halves every 180 days — a visit from 6 months ago counts
// at 50%, 12 months = 25%, etc. Old reviews never fully disappear but
// fresh community data progressively dominates.
const HALF_LIFE_DAYS = 180;
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_DAYS;

function reviewWeight(review) {
    const visitedAt = review.visitedAt || review.createdAt;
    const ageDays = (Date.now() - new Date(visitedAt).getTime()) / 86_400_000;
    return Math.exp(-DECAY_LAMBDA * ageDays);
}

function weightedAvg(reviews, field) {
    const pairs = reviews
        .map(r => ({ value: r[field], weight: reviewWeight(r) }))
        .filter(p => p.value != null);
    if (pairs.length === 0) return null;
    const totalWeight = pairs.reduce((sum, p) => sum + p.weight, 0);
    return pairs.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight;
}

/**
 * Recalculates aggregated sensory scores for a location.
 * Called after every new review. Uses exponential time-decay weighting
 * (half-life 180 days) so recent visits progressively override older data.
 * Raw slider values are 1-10; divided by 2 to store on the 1-5 scale.
 */
export const recalculateScores = async (locationId) => {
    const reviews = await prisma.review.findMany({
        where: { locationId },
        select: {
            noiseLevel: true,
            lightingLevel: true,
            crowdLevel: true,
            rating: true,
            visitedAt: true,
            createdAt: true,
        },
    });

    if (reviews.length === 0) return;

    const noiseScore    = weightedAvg(reviews, "noiseLevel")    != null ? weightedAvg(reviews, "noiseLevel")    / 2 : null;
    const lightingScore = weightedAvg(reviews, "lightingLevel") != null ? weightedAvg(reviews, "lightingLevel") / 2 : null;
    const crowdScore    = weightedAvg(reviews, "crowdLevel")    != null ? weightedAvg(reviews, "crowdLevel")    / 2 : null;
    const comfortScore  = weightedAvg(reviews, "rating")        != null ? weightedAvg(reviews, "rating")        / 2 : null;

    await prisma.sensoryScore.upsert({
        where: { locationId },
        update: { noiseScore, lightingScore, crowdScore, comfortScore, reviewCount: reviews.length },
        create: { locationId, noiseScore, lightingScore, crowdScore, comfortScore, reviewCount: reviews.length },
    });
};

export function getDisplayScore(location) {
    const {
        reviewCount,
        noiseScore, lightingScore, crowdScore,
        estimatedNoiseScore, estimatedLightingScore, estimatedCrowdScore,
    } = location;

    if (reviewCount >= 5) {
        return { noise: noiseScore, lighting: lightingScore, crowd: crowdScore, source: "community" };
    }
    if (reviewCount >= 1 && estimatedNoiseScore != null) {
        return {
            noise:    (noiseScore    * 0.7) + (estimatedNoiseScore    * 0.3),
            lighting: (lightingScore * 0.7) + (estimatedLightingScore * 0.3),
            crowd:    (crowdScore    * 0.7) + (estimatedCrowdScore    * 0.3),
            source: "community",
        };
    }
    if (estimatedNoiseScore != null) {
        return { noise: estimatedNoiseScore, lighting: estimatedLightingScore, crowd: estimatedCrowdScore, source: "estimated" };
    }
    return { noise: noiseScore, lighting: lightingScore, crowd: crowdScore, source: "category" };
}
