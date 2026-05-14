import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";

const router = express.Router();

// POST /checkins/:locationId
// Creates a check-in for the authenticated user (1-hour cooldown per location)
router.post("/:locationId", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;
        const { locationId } = req.params;

        const user = await prisma.user.findUnique({
            where: { auth0Id }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        // Cooldown check — 1 hour per location per user
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recent = await prisma.checkIn.findFirst({
            where: {
                userId: user.id,
                locationId,
                createdAt: { gte: oneHourAgo }
            },
            orderBy: { createdAt: "desc" }
        });

        if (recent) {
            const msLeft = new Date(recent.createdAt).getTime() + 60 * 60 * 1000 - Date.now();
            const minutesLeft = Math.ceil(msLeft / 60000);
            return res.status(429).json({
                error: "cooldown",
                message: `You already checked in here. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`,
                minutesLeft
            });
        }

        const checkIn = await prisma.checkIn.create({
            data: {
                userId: user.id,
                locationId
            }
        });

        res.status(201).json(checkIn);
    } catch (error) {
        console.error("Error creating check-in:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET /checkins/recent
// Returns recent check-ins for the authenticated user
router.get("/recent", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;

        const user = await prisma.user.findUnique({
            where: { auth0Id }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        const checkIns = await prisma.checkIn.findMany({
            where: { userId: user.id },
            include: { location: true },
            orderBy: { createdAt: "desc" },
            take: 10
        });

        res.json(checkIns);
    } catch (error) {
        console.error("Error fetching check-ins:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
