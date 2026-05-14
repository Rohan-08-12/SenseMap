import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";

const router = express.Router();

// DELETE /users/me — permanently delete the authenticated user's data
router.delete("/me", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;

        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        // Delete child records in dependency order before deleting the user
        await prisma.$transaction(async (tx) => {
            await tx.savedPlace.deleteMany({ where: { userId: user.id } });
            await tx.checkIn.deleteMany({ where: { userId: user.id } });
            await tx.review.deleteMany({ where: { userId: user.id } });
            await tx.sensoryProfile.deleteMany({ where: { userId: user.id } });
            await tx.user.delete({ where: { id: user.id } });
        });

        res.json({ message: "Account deleted successfully" });
    } catch (error) {
        console.error("Error deleting account:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
