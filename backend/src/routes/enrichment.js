import express from "express";
import prisma from "../lib/prisma.js";
import { model } from "../lib/gemini.js";
import { fetchAllSources } from "../services/scraper.js";
import { requireN8nSecret } from "../middleware/n8nAuth.js";
import { runEnrichment, runPhotoEnrichment, extractFacilities } from "../lib/enrichmentCron.js";
import { FACILITIES_OPTIONS, mergeFacilities } from "../lib/facilitiesOptions.js";

const router = express.Router();

const STALE_THRESHOLD_HOURS = 24 * 7; // weekly — stays within Yelp 5000/month limit

const analyzeSchema = {
    type: "object",
    properties: {
        noise_score:    { type: "number", description: "Noise level 1-10, where 1=silent and 10=extremely loud" },
        lighting_score: { type: "number", description: "Lighting intensity 1-10, where 1=dim and 10=harsh/bright" },
        crowd_score:    { type: "number", description: "Crowd density 1-10, where 1=empty and 10=packed" },
        confidence:     { type: "number", description: "Confidence in the scores 1-10, where 10=very confident" },
        sentiment:      { type: "string", enum: ["positive", "neutral", "negative"] },
        tags:           { type: "array",  items: { type: "string" } },
        summary:        { type: "string" },
        temperature_tags:         { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.temperature } },
        seating_tags:              { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.seating } },
        bathroom_tags:             { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.bathrooms } },
        social_interaction_tags:   { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.socialInteractions } },
    },
    required: ["noise_score", "lighting_score", "crowd_score", "confidence", "sentiment", "tags", "summary"],
};

// Gemini-only for background enrichment — Claude validation reserved for
// user-submitted reviews in /ai/analyze where accuracy matters most
async function analyzeText(name, reviewText) {
    if (!reviewText.trim()) return null;

    const prompt = `You are a sensory analysis assistant for autistic and sensory-sensitive people.

Analyze these reviews for "${name}" and extract structured sensory scores. Also infer, where the text gives any signal, the facility characteristics below — only include tags the text actually supports; leave a category's array empty if there's no signal for it. Use only the exact option strings listed (no new values):
- temperature_tags, from: ${FACILITIES_OPTIONS.temperature.join(", ")}
- seating_tags, from: ${FACILITIES_OPTIONS.seating.join(", ")}
- bathroom_tags, from: ${FACILITIES_OPTIONS.bathrooms.join(", ")}
- social_interaction_tags, from: ${FACILITIES_OPTIONS.socialInteractions.join(", ")}

Reviews:
${reviewText}`;

    const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: analyzeSchema },
    });

    return JSON.parse(result.response.text());
}

function scoresDiffer(current, newNoise, newLighting, newCrowd, threshold = 0.5) {
    if (current.estimatedNoiseScore == null) return true;
    return (
        Math.abs((current.estimatedNoiseScore ?? 0) - newNoise) > threshold ||
        Math.abs((current.estimatedLightingScore ?? 0) - newLighting) > threshold ||
        Math.abs((current.estimatedCrowdScore ?? 0) - newCrowd) > threshold
    );
}

// POST /enrichment/location — called by n8n for each location
router.post("/location", requireN8nSecret, async (req, res) => {
    try {
        const { locationId } = req.body;
        if (!locationId) return res.status(400).json({ error: "locationId required" });

        const location = await prisma.location.findUnique({ where: { id: locationId } });
        if (!location) return res.status(404).json({ error: "Location not found" });

        // Gather review text from all sources in parallel
        const { combinedText, sources, yelpId, osmFacilities } = await fetchAllSources({
            name: location.name,
            latitude: location.latitude,
            longitude: location.longitude,
            category: location.category,
            existingYelpId: location.externalYelpId,
            googlePlaceId: location.googlePlaceId,
        });

        if (!combinedText.trim()) {
            await prisma.location.update({
                where: { id: locationId },
                data: {
                    ...(yelpId && { externalYelpId: yelpId }),
                    ...(osmFacilities && { estimatedFacilities: osmFacilities }),
                    lastEnrichedAt: new Date(),
                    dataSource: "category",
                },
            });
            return res.json({ updated: false, reason: "no_review_text", sources });
        }

        const analysis = await analyzeText(location.name, combinedText);

        if (!analysis) {
            await prisma.location.update({
                where: { id: locationId },
                data: {
                    ...(yelpId && { externalYelpId: yelpId }),
                    ...(osmFacilities && { estimatedFacilities: osmFacilities }),
                    lastEnrichedAt: new Date(),
                },
            });
            return res.json({ updated: false, reason: "analysis_failed", sources });
        }

        // Convert 1-10 scores to 1-5
        const newNoise    = analysis.noise_score    / 2;
        const newLighting = analysis.lighting_score / 2;
        const newCrowd    = analysis.crowd_score    / 2;

        // OSM tags are exact/deterministic, so they take precedence over Gemini's
        // text-inferred guesses per category; Gemini only fills categories OSM has no tag for.
        const facilities = mergeFacilities(osmFacilities, extractFacilities(analysis));
        const needsUpdate = !location.lastEnrichedAt || scoresDiffer(location, newNoise, newLighting, newCrowd);

        if (!needsUpdate) {
            await prisma.location.update({
                where: { id: locationId },
                data: {
                    ...(yelpId && { externalYelpId: yelpId }),
                    ...(facilities && { estimatedFacilities: facilities }),
                    lastEnrichedAt: new Date(),
                },
            });
            return res.json({ updated: false, reason: "scores_unchanged", sources });
        }

        const confidence = analysis.confidence ?? null;
        const dataSource = sources.join(",") || "category";

        await prisma.location.update({
            where: { id: locationId },
            data: {
                ...(yelpId && { externalYelpId: yelpId }),
                estimatedNoiseScore:    newNoise,
                estimatedLightingScore: newLighting,
                estimatedCrowdScore:    newCrowd,
                enrichmentConfidence:   confidence,
                ...(facilities && { estimatedFacilities: facilities }),
                dataSource,
                lastEnrichedAt:         new Date(),
            },
        });

        await prisma.enrichmentLog.create({
            data: {
                locationId,
                scores: { noise: newNoise, lighting: newLighting, crowd: newCrowd, confidence, sources },
            },
        });

        res.json({ updated: true, noise: newNoise, lighting: newLighting, crowd: newCrowd, sources });
    } catch (error) {
        console.error("Enrichment error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET /enrichment/stale — returns locations due for enrichment
router.get("/stale", requireN8nSecret, async (_req, res) => {
    try {
        const cutoff = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

        const locations = await prisma.location.findMany({
            where: {
                OR: [
                    { lastEnrichedAt: null },
                    { lastEnrichedAt: { lt: cutoff } },
                ],
            },
            take: 450,
            orderBy: [
                { lastEnrichedAt: { sort: "asc", nulls: "first" } },
            ],
            select: {
                id: true,
                name: true,
                latitude: true,
                longitude: true,
                category: true,
                lastEnrichedAt: true,
                externalYelpId: true,
            },
        });

        res.json({ count: locations.length, locations });
    } catch (error) {
        console.error("Stale locations error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /enrichment/trigger — kicks off a background enrichment run
// ?force=true ignores the staleness window and re-processes every location —
// useful for backfilling a newly added field (e.g. estimatedFacilities) without waiting a week.
router.post("/trigger", requireN8nSecret, (req, res) => {
    const force = req.query.force === "true";
    runEnrichment({ force }).catch(err => console.error("[Enrichment] Trigger error:", err.message));
    res.json({ triggered: true, force, message: "Enrichment started in background" });
});

// POST /enrichment/photos — fetch and upload Google Places photos for all locations without images
router.post("/photos", requireN8nSecret, (_req, res) => {
    runPhotoEnrichment().catch(err => console.error("[Photos] Trigger error:", err.message));
    res.json({ triggered: true, message: "Photo enrichment started in background" });
});

export default router;
