import cron from "node-cron";
import prisma from "./prisma.js";
import { model } from "./gemini.js";
import { fetchAllSources } from "../services/scraper.js";

const STALE_THRESHOLD_HOURS = 24 * 7;
const BATCH_DELAY_MS = 1500; // 1.5s between calls — well within 1000 RPM Gemini limit

const analyzeSchema = {
    type: "object",
    properties: {
        noise_score:    { type: "number", description: "Noise level 1-10, where 1=silent and 10=extremely loud" },
        lighting_score: { type: "number", description: "Lighting intensity 1-10, where 1=dim and 10=harsh/bright" },
        crowd_score:    { type: "number", description: "Crowd density 1-10, where 1=empty and 10=packed" },
        sentiment:      { type: "string", enum: ["positive", "neutral", "negative"] },
        tags:           { type: "array",  items: { type: "string" } },
        summary:        { type: "string" },
    },
    required: ["noise_score", "lighting_score", "crowd_score", "sentiment", "tags", "summary"],
};

function scoresDiffer(location, newNoise, newLighting, newCrowd, threshold = 0.5) {
    if (location.estimatedNoiseScore == null) return true;
    return (
        Math.abs((location.estimatedNoiseScore ?? 0) - newNoise) > threshold ||
        Math.abs((location.estimatedLightingScore ?? 0) - newLighting) > threshold ||
        Math.abs((location.estimatedCrowdScore ?? 0) - newCrowd) > threshold
    );
}

async function enrichLocation(location) {
    const { combinedText, sources, yelpId } = await fetchAllSources({
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        existingYelpId: location.externalYelpId,
    });

    if (!combinedText.trim()) {
        await prisma.location.update({
            where: { id: location.id },
            data: {
                ...(yelpId && { externalYelpId: yelpId }),
                lastEnrichedAt: new Date(),
                dataSource: "category",
            },
        });
        return { updated: false, reason: "no_review_text" };
    }

    const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: `You are a sensory analysis assistant for autistic and sensory-sensitive people.\n\nAnalyze these reviews for "${location.name}" and extract structured sensory scores.\n\nReviews:\n${combinedText}` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: analyzeSchema },
    });

    const analysis = JSON.parse(result.response.text());

    const newNoise    = analysis.noise_score    / 2;
    const newLighting = analysis.lighting_score / 2;
    const newCrowd    = analysis.crowd_score    / 2;

    if (!scoresDiffer(location, newNoise, newLighting, newCrowd)) {
        await prisma.location.update({
            where: { id: location.id },
            data: { ...(yelpId && { externalYelpId: yelpId }), lastEnrichedAt: new Date() },
        });
        return { updated: false, reason: "scores_unchanged" };
    }

    await prisma.location.update({
        where: { id: location.id },
        data: {
            ...(yelpId && { externalYelpId: yelpId }),
            estimatedNoiseScore:    newNoise,
            estimatedLightingScore: newLighting,
            estimatedCrowdScore:    newCrowd,
            dataSource:             sources.join(",") || "category",
            lastEnrichedAt:         new Date(),
        },
    });

    await prisma.enrichmentLog.create({
        data: { locationId: location.id, scores: { noise: newNoise, lighting: newLighting, crowd: newCrowd, sources } },
    });

    return { updated: true, noise: newNoise, lighting: newLighting, crowd: newCrowd };
}

export async function runEnrichment() {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

    const locations = await prisma.location.findMany({
        where: { OR: [{ lastEnrichedAt: null }, { lastEnrichedAt: { lt: cutoff } }] },
        orderBy: [{ lastEnrichedAt: { sort: "asc", nulls: "first" } }],
        select: {
            id: true, name: true, latitude: true, longitude: true,
            category: true, externalYelpId: true,
            estimatedNoiseScore: true, estimatedLightingScore: true, estimatedCrowdScore: true,
        },
    });

    if (locations.length === 0) {
        console.log("[Enrichment] All locations up to date.");
        return;
    }

    console.log(`[Enrichment] Starting — ${locations.length} locations to process`);
    let updated = 0, skipped = 0, failed = 0;

    for (const location of locations) {
        try {
            const result = await enrichLocation(location);
            if (result.updated) updated++;
            else skipped++;
        } catch (err) {
            console.error(`[Enrichment] Failed ${location.name}:`, err.message);
            failed++;
        }
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }

    console.log(`[Enrichment] Done — updated: ${updated}, skipped: ${skipped}, failed: ${failed}`);
}

export function startEnrichmentCron() {
    // Runs daily at 4am Toronto time
    cron.schedule("0 4 * * *", () => {
        console.log("[Enrichment] Cron triggered");
        runEnrichment().catch(err => console.error("[Enrichment] Cron error:", err.message));
    }, { timezone: "America/Toronto" });

    console.log("[Enrichment] Cron scheduled — daily at 4am Toronto");
}
