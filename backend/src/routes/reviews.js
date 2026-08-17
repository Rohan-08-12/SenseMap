import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";
import { recalculateScores } from "../lib/scores.js";
import { FACILITIES_OPTIONS } from "../lib/facilitiesOptions.js";

const router = express.Router();

// Validates an optional facilities field: must be an array of strings, each a known option.
// Returns null (field omitted), a cleaned array, or throws a string error message.
function parseFacilitiesField(fieldName, value) {
    if (value == null) return undefined;
    if (!Array.isArray(value) || !value.every(v => typeof v === "string")) {
        throw new Error(`${fieldName} must be an array of strings`);
    }
    const allowed = FACILITIES_OPTIONS[fieldName];
    const invalid = value.filter(v => !allowed.includes(v));
    if (invalid.length > 0) {
        throw new Error(`${fieldName} contains invalid option(s): ${invalid.join(", ")}`);
    }
    // De-dupe while preserving order
    return [...new Set(value)];
}

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
        res.status(500).json({ error: "Failed to fetch reviews" });
    }
});

// POST /reviews — submit a review (protected)
router.post("/", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;
        const { locationId, bodyText, rating, noiseLevel, lightingLevel, crowdLevel, imageUrl, visitTime, temperature, seating, bathrooms, socialInteractions } = req.body;

        if (!locationId || typeof locationId !== "string") {
            return res.status(400).json({ error: "locationId is required" });
        }
        if (rating == null || noiseLevel == null || lightingLevel == null || crowdLevel == null) {
            return res.status(400).json({ error: "rating, noiseLevel, lightingLevel, and crowdLevel are required" });
        }
        if (![rating, noiseLevel, lightingLevel, crowdLevel].every(v => Number.isInteger(Number(v)) && v >= 1 && v <= 10)) {
            return res.status(400).json({ error: "rating and sensory levels must be integers between 1 and 10" });
        }
        if (bodyText && bodyText.length > 2000) {
            return res.status(400).json({ error: "Review text must be under 2000 characters" });
        }

        const VALID_VISIT_TIMES = ["morning", "afternoon", "evening", "night"];
        if (visitTime != null && !VALID_VISIT_TIMES.includes(visitTime)) {
            return res.status(400).json({ error: "Invalid visitTime — must be morning, afternoon, evening, or night" });
        }

        // Optional facilities fields — each is a validated array of strings, or omitted
        let parsedTemperature, parsedSeating, parsedBathrooms, parsedSocialInteractions;
        try {
            parsedTemperature = parseFacilitiesField("temperature", temperature);
            parsedSeating = parseFacilitiesField("seating", seating);
            parsedBathrooms = parseFacilitiesField("bathrooms", bathrooms);
            parsedSocialInteractions = parseFacilitiesField("socialInteractions", socialInteractions);
        } catch (err) {
            return res.status(400).json({ error: err.message });
        }

        // Only accept Cloudinary-hosted image URLs to prevent SSRF / XSS via imageUrl
        if (imageUrl != null) {
            if (typeof imageUrl !== "string" || !/^https:\/\/res\.cloudinary\.com\//.test(imageUrl)) {
                return res.status(400).json({ error: "Invalid imageUrl — must be a Cloudinary URL" });
            }
        }

        const user = await prisma.user.findUnique({ where: { auth0Id } });
        if (!user) return res.status(404).json({ error: "User not found" });

        const review = await prisma.review.create({
            data: {
                userId: user.id,
                locationId,
                bodyText: bodyText ?? "",
                rating: Number(rating),
                noiseLevel: Number(noiseLevel),
                lightingLevel: Number(lightingLevel),
                crowdLevel: Number(crowdLevel),
                imageUrl: imageUrl ?? null,
                visitTime: visitTime ?? null,
                ...(parsedTemperature !== undefined && { temperature: parsedTemperature }),
                ...(parsedSeating !== undefined && { seating: parsedSeating }),
                ...(parsedBathrooms !== undefined && { bathrooms: parsedBathrooms }),
                ...(parsedSocialInteractions !== undefined && { socialInteractions: parsedSocialInteractions }),
            }
        });

        await recalculateScores(locationId);

        res.status(201).json(review);
    } catch (error) {
        console.error("Error creating review:", error);
        res.status(500).json({ error: "Failed to submit review" });
    }
});

export default router;