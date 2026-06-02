import express from "express";
import prisma from "../lib/prisma.js";

const router = express.Router();

// router.get("/", (req, res) => {
//     res.json({ message: "rankings route live" });
// });

/**
 * GET /rankings
 * Fetches the highest-ranked locations across the platform based on community `comfortScore`.
 * Used to populate the "Top ranked sensory-friendly places" sidebar in the UI.
 */
router.get("/", async (req, res) => {
    try {
        const locations = await prisma.location.findMany({
            take: 500,
            select: {
                id: true,
                name: true,
                category: true,
                address: true,
                latitude: true,
                longitude: true,
                estimatedNoiseScore: true,
                estimatedLightingScore: true,
                estimatedCrowdScore: true,
                sensoryScores: {
                    select: {
                        noiseScore: true,
                        lightingScore: true,
                        crowdScore: true,
                        comfortScore: true,
                        reviewCount: true,
                    }
                }
            }
        });

        const result = locations
            .map((loc) => {
                const s = loc.sensoryScores;
                // Community scores when real reviews exist; AI-estimated next; OSM defaults last
                const noise    = (s?.reviewCount > 0 ? s?.noiseScore    : null) ?? loc.estimatedNoiseScore ?? s?.noiseScore;
                const lighting = (s?.reviewCount > 0 ? s?.lightingScore : null) ?? loc.estimatedLightingScore ?? s?.lightingScore;
                const crowd    = (s?.reviewCount > 0 ? s?.crowdScore    : null) ?? loc.estimatedCrowdScore ?? s?.crowdScore;
                if (noise == null) return null;

                // Only use community comfortScore when real reviews exist; otherwise derive from sensory intensity
                // Guard nulls explicitly — JS coerces null to 0 in arithmetic, producing out-of-range values
                const communityComfort = s?.reviewCount > 0 ? s?.comfortScore : null;
                const estimatedComfort = (noise != null && lighting != null && crowd != null)
                    ? Math.min(5, Math.max(1, 6 - (noise + lighting + crowd) / 3))
                    : null;
                const comfort = communityComfort ?? estimatedComfort;

                return {
                    locationId: loc.id,
                    name: loc.name,
                    category: loc.category,
                    address: loc.address,
                    longitude: loc.longitude,
                    latitude: loc.latitude,
                    comfortScore: +comfort.toFixed(2),
                    noiseScore: noise,
                    lightingScore: lighting,
                    crowdScore: crowd,
                    reviewCount: s?.reviewCount ?? 0,
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.comfortScore - a.comfortScore)
            .map((loc, index) => ({ rank: index + 1, ...loc }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching rankings:", error);
        res.status(500).json({ error: "Failed to fetch rankings" });
    }
});

export default router;