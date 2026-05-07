import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";

const router = express.Router();

// GET /profiles/me — get my sensory profile (protected)
router.get("/me", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;

        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const profile = await prisma.sensoryProfile.upsert({
            where: { userId: user.id },
            update: {},
            create: {
                userId: user.id,
                noiseTolerance: 3,
                lightingTolerance: 3,
                crowdTolerance: 3,
            }
        });

        res.json(profile);
    } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /profiles/me — create or update my sensory profile (protected)
router.put("/me", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;
        const { noiseTolerance, lightingTolerance, crowdTolerance, notes } = req.body;

        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const profile = await prisma.sensoryProfile.upsert({
            where: { userId: user.id },
            update: { noiseTolerance, lightingTolerance, crowdTolerance, notes },
            create: { userId: user.id, noiseTolerance, lightingTolerance, crowdTolerance, notes }
        });

        res.json(profile);
    } catch (error) {
        console.error("Error saving profile:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;