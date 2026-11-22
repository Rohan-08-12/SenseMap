import express from "express";
import prisma from "../lib/prisma.js";
import { model } from "../lib/gemini.js";
import { fetchAllSources } from "../services/scraper.js";
import { requireN8nSecret } from "../middleware/n8nAuth.js";
import { startEnrichmentRun, executeEnrichmentRun, selectLocationsToEnrich, runPhotoEnrichment, extractFacilities } from "../lib/enrichmentCron.js";
import { resolveLimit } from "../lib/enrichmentConfig.js";
import { FACILITIES_OPTIONS, mergeFacilities } from "../lib/facilitiesOptions.js";
import { getFreshness } from "../lib/enrichmentRuns.js";
import { requestAnalysis, interpretAnalysis, skipUpdateData } from "../lib/enrichmentAnalysis.js";
import { logIncomplete } from "../lib/enrichmentBackoff.js";

const router = express.Router();


// Gemini-only for background enrichment — Claude validation reserved for
// user-submitted reviews in /ai/analyze where accuracy matters most
async function analyzeText(name, reviewText) {
    if (!reviewText.trim()) return null;

    return requestAnalysis(model, name, reviewText);
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

        // Same guard as the nightly cron: reject out-of-range scores (e.g. Gemini returning 0)
        // instead of saving them, but still keep the deterministic OSM facilities.
        const decision = interpretAnalysis(analysis);
        if (decision.action === "skip") {
            const data = skipUpdateData(decision, { yelpId, osmFacilities });
            if (data) await prisma.location.update({ where: { id: locationId }, data });
            if (decision.reason === "incomplete_scores") await logIncomplete(prisma, locationId, decision, sources);
            return res.json({ updated: false, reason: decision.reason, confidence: decision.confidence, sources });
        }

        const { noise: newNoise, lighting: newLighting, crowd: newCrowd } = decision;

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
                    enrichmentConfidence: decision.confidence,
                    lastEnrichedAt: new Date(),
                },
            });
            return res.json({ updated: false, reason: "scores_unchanged", sources });
        }

        const confidence = decision.confidence;
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

const LIMIT_ERROR = "limit must be a positive integer";
// ?limit=N: absent -> default (ENRICHMENT_MAX_PER_RUN); a positive integer -> clamped to 1-1000 later by
// resolveLimit(); anything else (0, negative, decimal, text) is rejected rather than guessed at.
function parseLimit(raw) {
    if (raw === undefined) return { ok: true, limit: undefined };
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw.trim())) return { ok: false };
    return { ok: true, limit: Number(raw.trim()) };
}

// GET /enrichment/stale: a preview of exactly what the next run would process (same selection as the cron and
// /trigger, including the per-run cap and the incomplete-scores backoff). ?limit=N sizes the preview;
// ?force=true previews a forced run.
router.get("/stale", requireN8nSecret, async (req, res) => {
    try {
        const parsed = parseLimit(req.query.limit);
        if (!parsed.ok) return res.status(400).json({ error: LIMIT_ERROR });
        const force = req.query.force === "true";
        const limit = resolveLimit(parsed.limit);

        const locations = await selectLocationsToEnrich({ force, limit });
        res.json({ count: locations.length, limit, force, locations });
    } catch (error) {
        console.error("Stale locations error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /enrichment/trigger — kicks off a background enrichment run
// ?force=true ignores the staleness window (useful for backfilling a newly added field, e.g. estimatedFacilities)
// ?limit=N sizes a manual batch (positive integer, clamped to 1-1000); every run is capped, forced ones included.
router.post("/trigger", requireN8nSecret, async (req, res) => {
    try {
        const parsed = parseLimit(req.query.limit);
        if (!parsed.ok) return res.status(400).json({ triggered: false, error: LIMIT_ERROR });
        const force = req.query.force === "true";
        const run = await startEnrichmentRun({ trigger: force ? "trigger-force" : "trigger", force, limit: parsed.limit });
        if (!run) return res.status(409).json({ triggered: false, error: "An enrichment run is already in progress" });

        executeEnrichmentRun(run).catch(err => console.error("[Enrichment] Trigger error:", err.message));
        res.json({ triggered: true, force, limit: run.limit, runId: run.id, message: "Enrichment started in background" });
    } catch (error) {
        console.error("Enrichment trigger error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// GET /enrichment/freshness — data-freshness report for n8n / uptime monitors (n8n secret only).
// Add ?strict=true to get HTTP 503 when there's been no successful run in 36h, so a plain
// status-code monitor can alert without parsing the body.
router.get("/freshness", requireN8nSecret, async (req, res) => {
    try {
        const report = await getFreshness();
        const status = req.query.strict === "true" && !report.healthy ? 503 : 200;
        res.status(status).json(report);
    } catch (error) {
        console.error("Freshness error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

// POST /enrichment/photos — fetch and upload Google Places photos for all locations without images
router.post("/photos", requireN8nSecret, (_req, res) => {
    runPhotoEnrichment().catch(err => console.error("[Photos] Trigger error:", err.message));
    res.json({ triggered: true, message: "Photo enrichment started in background" });
});

export default router;
