import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";
import { displayScoreForLocation, locationHasTrustworthyScores } from "../lib/scores.js";

const router = express.Router();

// GET /saved-places — get my saved places (protected)
router.get("/", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;
        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const saved = await prisma.savedPlace.findMany({
            where: { userId: user.id },
            include: {
                location: {
                    select: {
                        id: true, name: true, category: true, address: true,
                        description: true, imageUrl: true, latitude: true, longitude: true,
                        estimatedNoiseScore: true, estimatedLightingScore: true, estimatedCrowdScore: true, enrichmentConfidence: true,
                        sensoryScores: true,
                    }
                }
            },
            orderBy: { createdAt: "desc" }
        });

        // Same rule as the rest of the app: numbers only when the scores are trustworthy (otherwise null, never 0).
        res.json(saved.map((sp) => {
            const trustworthy = sp.location ? locationHasTrustworthyScores(sp.location) : false;
            const d = trustworthy ? displayScoreForLocation(sp.location) : null;
            const { enrichmentConfidence, ...location } = sp.location ?? {};
            return {
                ...sp,
                location: {
                    ...location,
                    trustworthy,
                    displayScores: d && { noise: d.noise, lighting: d.lighting, crowd: d.crowd, comfort: d.comfort ?? Math.max(1, 6 - (d.noise + d.lighting + d.crowd) / 3) },
                },
            };
        }));
    } catch (error) {
        console.error("Error fetching saved places:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /saved-places — save a location (protected)
router.post("/", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;
        const { locationId } = req.body;

        if (!locationId || typeof locationId !== "string") {
            return res.status(400).json({ error: "locationId is required" });
        }

        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const saved = await prisma.savedPlace.create({
            data: { userId: user.id, locationId }
        });

        res.status(201).json(saved);
    } catch (error) {
        console.error("Error saving place:", error);
        res.status(500).json({ error: "Failed to save place" });
    }
});

// DELETE /saved-places/:locationId — remove saved location (protected)
router.delete("/:locationId", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;
        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        await prisma.savedPlace.delete({
            where: {
                userId_locationId: {
                    userId: user.id,
                    locationId: req.params.locationId
                }
            }
        });

        res.json({ message: "Removed from saved places" });
    } catch (error) {
        console.error("Error removing saved place:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;