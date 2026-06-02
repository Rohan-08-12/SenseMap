import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";

const router = express.Router();

async function getAuth0ManagementToken() {
    const res = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: "client_credentials",
            client_id: process.env.AUTH0_MANAGEMENT_CLIENT_ID,
            client_secret: process.env.AUTH0_MANAGEMENT_CLIENT_SECRET,
            audience: `${process.env.AUTH0_ISSUER_BASE_URL}/api/v2/`,
        }),
    });
    const data = await res.json();
    return data.access_token;
}

async function deleteAuth0User(auth0Id) {
    if (!process.env.AUTH0_MANAGEMENT_CLIENT_ID || !process.env.AUTH0_MANAGEMENT_CLIENT_SECRET) {
        console.warn("[Auth0] Management credentials not set — skipping Auth0 user deletion");
        return;
    }
    const token = await getAuth0ManagementToken();
    const encoded = encodeURIComponent(auth0Id);
    const res = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/api/v2/users/${encoded}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) {
        const body = await res.text();
        throw new Error(`Auth0 deletion failed (${res.status}): ${body}`);
    }
}

// DELETE /users/me — permanently delete the authenticated user's data
router.delete("/me", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;

        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        // Delete all app data first, then remove the Auth0 account
        await prisma.$transaction(async (tx) => {
            await tx.savedPlace.deleteMany({ where: { userId: user.id } });
            await tx.checkIn.deleteMany({ where: { userId: user.id } });
            await tx.review.deleteMany({ where: { userId: user.id } });
            await tx.sensoryProfile.deleteMany({ where: { userId: user.id } });
            await tx.user.delete({ where: { id: user.id } });
        });

        await deleteAuth0User(auth0Id);

        res.json({ message: "Account deleted successfully" });
    } catch (error) {
        console.error("Error deleting account:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
