import cron from "node-cron";
import prisma from "./prisma.js";
import { model } from "./gemini.js";
import { fetchAllSources } from "../services/scraper.js";
import { searchGooglePlaces, getGooglePlaceDetails, uploadPlacePhoto } from "./placesService.js";
import { FACILITIES_OPTIONS, mergeFacilities } from "./facilitiesOptions.js";
import { acquireRun, heartbeat, finishRun } from "./enrichmentRuns.js";
import { requestAnalysis, interpretAnalysis, skipUpdateData, GeminiRequestError } from "./enrichmentAnalysis.js";
import { STALE_THRESHOLD_HOURS, idsInIncompleteBackoff, logIncomplete, staleWhere } from "./enrichmentBackoff.js";
import { resolveLimit, delayMs, MAX_CONSECUTIVE_GEMINI_FAILURES } from "./enrichmentConfig.js";

// Maps the Gemini schema's *_tags keys to the canonical facilities field names
// used everywhere else (Review columns, FACILITIES_OPTIONS, frontend pills).
const FACILITIES_TAG_KEYS = {
    temperature: "temperature_tags",
    seating: "seating_tags",
    bathrooms: "bathroom_tags",
    socialInteractions: "social_interaction_tags",
};

// Builds a validated { temperature, seating, bathrooms, socialInteractions } object from
// a Gemini analysis result — only known options survive, empty categories are omitted.
// Returns null if nothing usable was inferred (so callers can skip storing it).
// Exported so routes/enrichment.js's separate n8n-triggered single-location endpoint
// (which duplicates this cron's analysis logic) can produce the same estimatedFacilities shape.
export function extractFacilities(analysis) {
    const facilities = {};
    for (const [field, tagKey] of Object.entries(FACILITIES_TAG_KEYS)) {
        const raw = analysis[tagKey];
        if (!Array.isArray(raw)) continue;
        const valid = [...new Set(raw.filter(t => typeof t === "string" && FACILITIES_OPTIONS[field].includes(t)))];
        if (valid.length > 0) facilities[field] = valid;
    }
    return Object.keys(facilities).length > 0 ? facilities : null;
}

function scoresDiffer(location, newNoise, newLighting, newCrowd, threshold = 0.5) {
    if (location.estimatedNoiseScore == null) return true;
    return (
        Math.abs((location.estimatedNoiseScore ?? 0) - newNoise) > threshold ||
        Math.abs((location.estimatedLightingScore ?? 0) - newLighting) > threshold ||
        Math.abs((location.estimatedCrowdScore ?? 0) - newCrowd) > threshold
    );
}

async function enrichLocation(location) {
    const { combinedText, sources, yelpId, osmFacilities } = await fetchAllSources({
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        category: location.category,
        existingYelpId: location.externalYelpId,
        googlePlaceId: location.googlePlaceId,
    });

    if (!combinedText.trim()) {
        // No review-style text to analyze, but OSM tags (structured, not text-derived) may still
        // apply — e.g. a park with no Yelp/Google/Foursquare presence can still have toilets=yes.
        await prisma.location.update({
            where: { id: location.id },
            data: {
                ...(yelpId && { externalYelpId: yelpId }),
                ...(osmFacilities && { estimatedFacilities: osmFacilities }),
                lastEnrichedAt: new Date(),
                dataSource: "category",
            },
        });
        return { updated: false, reason: "no_review_text" };
    }

    const analysis = await requestAnalysis(model, location.name, combinedText);
    // OSM tags are exact/deterministic, so they take precedence over Gemini's text-inferred
    // guesses per category; Gemini only fills categories OSM has no tag for.
    const facilities = mergeFacilities(osmFacilities, extractFacilities(analysis));

    // Reject anything that is not a finite number in 1-10, and never store estimates when the model
    // reported no sensory signal (null scores) — see enrichmentAnalysis.interpretAnalysis.
    const decision = interpretAnalysis(analysis);
    if (decision.action === "skip") {
        const data = skipUpdateData(decision, { yelpId, osmFacilities });
        if (data) await prisma.location.update({ where: { id: location.id }, data });
        if (decision.reason === "incomplete_scores") await logIncomplete(prisma, location.id, decision, sources);
        return { updated: false, reason: decision.reason };
    }

    const { noise: newNoise, lighting: newLighting, crowd: newCrowd } = decision;

    if (!scoresDiffer(location, newNoise, newLighting, newCrowd)) {
        await prisma.location.update({
            where: { id: location.id },
            data: {
                ...(yelpId && { externalYelpId: yelpId }),
                ...(facilities && { estimatedFacilities: facilities }),
                enrichmentConfidence: decision.confidence,
                lastEnrichedAt: new Date(),
            },
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
            enrichmentConfidence:   decision.confidence,
            ...(facilities && { estimatedFacilities: facilities }),
            dataSource:             sources.join(",") || "category",
            lastEnrichedAt:         new Date(),
        },
    });

    await prisma.enrichmentLog.create({
        data: { locationId: location.id, scores: { noise: newNoise, lighting: newLighting, crowd: newCrowd, confidence: decision.confidence, sources } },
    });

    return { updated: true, noise: newNoise, lighting: newLighting, crowd: newCrowd };
}

/**
 * The places an enrichment run would process: stale (or never enriched) and not inside the
 * incomplete-scores backoff, oldest first. Every selection is capped (ENRICHMENT_MAX_PER_RUN, default 50,
 * or an explicit `limit`, both clamped to 1-1000), forced runs included, so no run is unbounded.
 * Exported so scripts/check_backoff_query.js can exercise the exact production query.
 */
export async function selectLocationsToEnrich({ force = false, limit } = {}) {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
    // Places whose last analysis was incomplete are left alone for 30 days (a forced run ignores this).
    const backoffIds = force ? [] : await idsInIncompleteBackoff(prisma);

    return prisma.location.findMany({
        // force=true (manual backfill trigger) ignores staleness, re-processing places regardless of
        // when they were last enriched (e.g. to seed estimatedFacilities onto places enriched before
        // that field existed) but is still capped, so a backlog is worked through in batches instead
        // of spiking Gemini / Google Places spend and quota in one run.
        where: force ? {} : staleWhere(cutoff, backoffIds),
        orderBy: [{ lastEnrichedAt: { sort: "asc", nulls: "first" } }],
        take: resolveLimit(limit),
        select: {
            id: true, name: true, latitude: true, longitude: true,
            category: true, externalYelpId: true, googlePlaceId: true,
            estimatedNoiseScore: true, estimatedLightingScore: true, estimatedCrowdScore: true,
            lastEnrichedAt: true,
        },
    });
}

/**
 * Claims the run lock and records a run row. Returns the row, or null if a run is already
 * in progress (callers should skip / respond 409). Pair with executeEnrichmentRun(run). `limit` (optional,
 * clamped 1-1000) sizes a manual batch; otherwise ENRICHMENT_MAX_PER_RUN applies.
 */
export async function startEnrichmentRun({ trigger = "cron", force = false, limit } = {}) {
    const run = await acquireRun({ trigger, force });
    // `limit` is not stored on the run row; it travels with the returned object into executeEnrichmentRun.
    return run ? { ...run, limit: resolveLimit(limit) } : null;
}

export async function executeEnrichmentRun(run) {
    const { force, limit } = run;
    const counts = { planned: 0, updated: 0, skipped: 0, failed: 0 };
    const errors = [];

    try {
        const locations = await selectLocationsToEnrich({ force, limit });

        counts.planned = locations.length;

        if (locations.length === 0) {
            console.log("[Enrichment] All locations up to date.");
            await finishRun(run.id, { status: "success", counts });
            return;
        }

        console.log(`[Enrichment] Starting — ${locations.length} locations to process`);
        await heartbeat(run.id, counts);

        const pauseMs = delayMs();   // ENRICHMENT_DELAY_MS, default 2000
        let geminiStreak = 0;        // consecutive Gemini failures; any successful Gemini call resets it
        let stoppedEarly = null;
        for (let i = 0; i < locations.length; i++) {
            const location = locations[i];
            try {
                const result = await enrichLocation(location);
                if (result.updated) counts.updated++;
                else counts.skipped++;
                // Every outcome except "no review text" came after a successful Gemini call.
                if (result.reason !== "no_review_text") geminiStreak = 0;
            } catch (err) {
                console.error(`[Enrichment] Failed ${location.name}:`, err.message);
                counts.failed++;
                errors.push({ location: location.name, message: String(err.message).slice(0, 300) });
                if (err instanceof GeminiRequestError) geminiStreak++;   // other errors neither extend nor reset the streak
            }
            // A heartbeat failure (e.g. transient DB blip) must not abort the whole run.
            await heartbeat(run.id, counts).catch(err => console.error("[Enrichment] Heartbeat failed:", err.message));

            if (geminiStreak >= MAX_CONSECUTIVE_GEMINI_FAILURES) {
                const last = errors.at(-1)?.message ?? "unknown error";
                stoppedEarly = `Stopped early after ${MAX_CONSECUTIVE_GEMINI_FAILURES} consecutive Gemini failures (last: ${last})`.slice(0, 500);
                break;
            }
            if (pauseMs > 0 && i < locations.length - 1) await new Promise(r => setTimeout(r, pauseMs));
        }

        console.log(`[Enrichment] Done — updated: ${counts.updated}, skipped: ${counts.skipped}, failed: ${counts.failed}`);
        if (stoppedEarly) {
            // Status "failed" (the existing non-success status): a run that bailed must not count as healthy. Finishing the
            // row also releases the lock, so the next trigger or the next night's cron can start normally.
            console.error(`[Enrichment] ${stoppedEarly}`);
            await finishRun(run.id, { status: "failed", counts, errors, errorMessage: stoppedEarly });
            return;
        }
        // Every location failing means something systemic (bad API key, quota, outage) — don't
        // let that count as a "successful" run or the freshness alert would never fire.
        const allFailed = counts.failed === counts.planned;
        await finishRun(run.id, {
            status: allFailed ? "failed" : "success",
            counts, errors,
            errorMessage: allFailed ? "Every location failed" : undefined,
        });
    } catch (err) {
        console.error("[Enrichment] Run aborted:", err.message);
        await finishRun(run.id, { status: "failed", counts, errors, errorMessage: String(err.message).slice(0, 500) })
            .catch(e => console.error("[Enrichment] Could not record failure:", e.message));
        throw err;
    }
}

// Acquire the lock and run to completion. Used by the cron; the trigger endpoint calls the two
// halves separately so it can answer 409 immediately when a run is already in progress.
export async function runEnrichment({ force = false, trigger = "cron", limit } = {}) {
    const run = await startEnrichmentRun({ trigger, force, limit });
    if (!run) {
        console.log("[Enrichment] Skipped — another run is already in progress.");
        return null;
    }
    await executeEnrichmentRun(run);
    return run.id;
}

export async function runPhotoEnrichment() {
    const locations = await prisma.location.findMany({
        where: { imageUrl: null },
        select: { id: true, name: true, latitude: true, longitude: true, googlePlaceId: true },
    });

    if (locations.length === 0) {
        console.log("[Photos] All locations already have images.");
        return;
    }

    console.log(`[Photos] Starting — ${locations.length} locations need images`);
    let saved = 0, failed = 0;

    for (const loc of locations) {
        try {
            // OSM-imported locations store osm_ prefixed IDs — not valid Google Place IDs
            const rawId = loc.googlePlaceId;
            let placeId = (rawId && !rawId.startsWith('osm_')) ? rawId : null;

            if (!placeId) {
                const results = await searchGooglePlaces(loc.name, loc.latitude, loc.longitude);
                placeId = results[0]?.place_id ?? null;
                if (placeId) {
                    await prisma.location.update({ where: { id: loc.id }, data: { googlePlaceId: placeId } });
                }
            }

            if (!placeId) {
                failed++;
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const details = await getGooglePlaceDetails(placeId);
            const photoRef = details?.photos?.[0]?.photo_reference;

            if (!photoRef) {
                failed++;
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }

            const imageUrl = await uploadPlacePhoto(photoRef);
            if (imageUrl) {
                await prisma.location.update({ where: { id: loc.id }, data: { imageUrl } });
                saved++;
                console.log(`[Photos] ${loc.name} ✓`);
            } else {
                failed++;
            }
        } catch (err) {
            console.error(`[Photos] Failed ${loc.name}:`, err.message);
            failed++;
        }
        await new Promise(r => setTimeout(r, 2000)); // 2s gap — Google Places rate limit
    }

    console.log(`[Photos] Done — saved: ${saved}, failed: ${failed}`);
}

export function startEnrichmentCron() {
    // Runs daily at 4am Toronto time
    cron.schedule("0 4 * * *", () => {
        console.log("[Enrichment] Cron triggered");
        runEnrichment().catch(err => console.error("[Enrichment] Cron error:", err.message));
    }, { timezone: "America/Toronto" });

    console.log("[Enrichment] Cron scheduled — daily at 4am Toronto");
}
