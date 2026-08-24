import express from "express";
import prisma from "../lib/prisma.js";
import { notifyNewSubscriber } from "../lib/notify.js";

const router = express.Router();

// Deliberately simple — good enough to reject garbage input without rejecting real addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_SOURCES = new Set(["banner", "settings"]);

// POST /subscribe — capture an email for the weekly quiet-spots digest (public)
router.post("/", async (req, res) => {
    try {
        const { email, source } = req.body || {};

        if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
            return res.status(400).json({ error: "A valid email address is required" });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const normalizedSource = ALLOWED_SOURCES.has(source) ? source : null;

        const existing = await prisma.emailSubscriber.findUnique({ where: { email: normalizedEmail } });

        await prisma.emailSubscriber.upsert({
            where: { email: normalizedEmail },
            update: { active: true },
            create: { email: normalizedEmail, source: normalizedSource },
        });

        // Only ping the admin inbox for genuinely new subscribers, not repeat/duplicate submits.
        if (!existing) {
            notifyNewSubscriber({ email: normalizedEmail, source: normalizedSource }); // fire-and-forget
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Error saving email subscriber:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
