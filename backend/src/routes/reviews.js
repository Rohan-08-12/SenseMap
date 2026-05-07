import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";
import { recalculateScores } from "../lib/scores.js";

const router = express.Router();

// GET /reviews/:locationId — get reviews for a location (public)
router.get("/:locationId", async (req, res) => {
    try {
        const reviews = await prisma.review.findMany({
            where: { locationId: req.params.locationId },
            orderBy: { createdAt: "desc" },
        });
        res.json(reviews);
    } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ error: error.message });
    }
});

// POST /reviews — submit a review (protected)
router.post("/", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;
        const { locationId, bodyText, rating, noiseLevel, lightingLevel, crowdLevel, imageUrl } = req.body;

        if (!locationId || rating == null || noiseLevel == null || lightingLevel == null || crowdLevel == null) {
            return res.status(400).json({ error: "locationId, rating, noiseLevel, lightingLevel, and crowdLevel are required" });
        }

        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const review = await prisma.review.create({
            data: {
                userId: user.id,
                locationId,
                bodyText,
                rating,
                noiseLevel,
                lightingLevel,
                crowdLevel,
                imageUrl: imageUrl ?? null,
            }
        });

        // recalculate scores after new review
        await recalculateScores(locationId);

        res.status(201).json(review);
    } catch (error) {
        console.error("Error creating review:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;