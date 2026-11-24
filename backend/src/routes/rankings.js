import express from "express";
import prisma from "../lib/prisma.js";
import { displayScoreForLocation, locationHasTrustworthyScores } from "../lib/scores.js";

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
        // No take() cap: ranking an unordered 500-row slice excluded most locations from the top list.
        const locations = await prisma.location.findMany({
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
                enrichmentConfidence: true,
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

        // Same rule and same numbers as the place panel: displayScoreForLocation + hasTrustworthyScores. Places with no
        // trustworthy scores (no data, category placeholders, all-floor AI estimates) are left out, never ranked.
        const result = locations
            .filter(locationHasTrustworthyScores)
            .map((loc) => {
                const d = displayScoreForLocation(loc);
                // No upper clamp: see getDisplayScore. d.comfort is the community rating when there is one.
                const comfort = d.comfort ?? Math.max(1, 6 - (d.noise + d.lighting + d.crowd) / 3);
                return {
                    locationId: loc.id,
                    name: loc.name,
                    category: loc.category,
                    address: loc.address,
                    longitude: loc.longitude,
                    latitude: loc.latitude,
                    comfortScore: +comfort.toFixed(2),
                    noiseScore: d.noise,
                    lightingScore: d.lighting,
                    crowdScore: d.crowd,
                    reviewCount: loc.sensoryScores?.reviewCount ?? 0,
                };
            })
            .sort((a, b) => b.comfortScore - a.comfortScore)
            .map((loc, index) => ({ rank: index + 1, ...loc }));

        // Read-mostly public data — let browsers/CDNs reuse it briefly.
        res.set("Cache-Control", "public, max-age=60");
        res.json(result);
    } catch (error) {
        console.error("Error fetching rankings:", error);
        res.status(500).json({ error: "Failed to fetch rankings" });
    }
});

export default router;