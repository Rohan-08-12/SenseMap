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
    console.log("Received GET /rankings");
    try {
        const rankings = await prisma.sensoryScore.findMany({
            orderBy: { comfortScore: "desc" },
            include: {
                location: {
                    select: {
                        id: true,
                        name: true,
                        category: true,
                        address: true,
                        latitude: true,
                        longitude: true,
                    }
                }

            },
        });

        const result = rankings.map((r, index) => ({
            rank: index + 1,
            locationId: r.location.id,
            name: r.location.name,
            category: r.location.category,
            address: r.location.address,
            longitude: r.location.longitude,
            latitude: r.location.latitude,
            comfortScore: r.comfortScore,
            noiseScore: r.noiseScore,
            lightingScore: r.lightingScore,
            crowdScore: r.crowdScore,
            reviewCount: r.reviewCount,
        }));

        res.json(result);
    } catch (error) {
        console.error("Error fetching rankings:", error);
        res.status(500).json({ error: "Failed to fetch rankings" });
    }
});

export default router;