import cron from "node-cron";
import prisma from "./prisma.js";
import { model } from "./gemini.js";
import { fetchAllSources } from "../services/scraper.js";
import { searchGooglePlaces, getGooglePlaceDetails, uploadPlacePhoto } from "./placesService.js";
import { FACILITIES_OPTIONS, mergeFacilities } from "./facilitiesOptions.js";

const STALE_THRESHOLD_HOURS = 24 * 7;
const BATCH_DELAY_MS = 1500; // 1.5s between calls — well within 1000 RPM Gemini limit

// Caps how many locations a single unforced nightly run touches. Without this, a backlog of
// simultaneously-stale locations (e.g. all last enriched in the same original batch job) would
// get reprocessed in one lump instead of trickling in — spiking Google Places/Yelp/Foursquare
// spend and quota in a single run. force=true (manual backfill trigger) ignores this cap.
const NIGHTLY_BATCH_LIMIT = 200;

const analyzeSchema = {
    type: "object",
    properties: {
        noise_score:    { type: "number", description: "Noise level 1-10, where 1=silent and 10=extremely loud" },
        lighting_score: { type: "number", description: "Lighting intensity 1-10, where 1=dim and 10=harsh/bright" },
        crowd_score:    { type: "number", description: "Crowd density 1-10, where 1=empty and 10=packed" },
        sentiment:      { type: "string", enum: ["positive", "neutral", "negative"] },
        tags:           { type: "array",  items: { type: "string" } },
        summary:        { type: "string" },
        temperature_tags:         { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.temperature } },
        seating_tags:              { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.seating } },
        bathroom_tags:             { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.bathrooms } },
        social_interaction_tags:   { type: "array", items: { type: "string", enum: FACILITIES_OPTIONS.socialInteractions } },
    },
    required: ["noise_score", "lighting_score", "crowd_score", "sentiment", "tags", "summary"],
};

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

    const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: `You are a sensory analysis assistant for autistic and sensory-sensitive people.\n\nAnalyze these reviews for "${location.name}" and extract structured sensory scores. Also infer, where the text gives any signal, the facility characteristics below — only include tags the text actually supports; leave a category's array empty if there's no signal for it. Use only the exact option strings listed (no new values):\n- temperature_tags, from: ${FACILITIES_OPTIONS.temperature.join(", ")}\n- seating_tags, from: ${FACILITIES_OPTIONS.seating.join(", ")}\n- bathroom_tags, from: ${FACILITIES_OPTIONS.bathrooms.join(", ")}\n- social_interaction_tags, from: ${FACILITIES_OPTIONS.socialInteractions.join(", ")}\n\nReviews:\n${combinedText}` }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: analyzeSchema },
    });

    const analysis = JSON.parse(result.response.text());
    // OSM tags are exact/deterministic, so they take precedence over Gemini's text-inferred
    // guesses per category; Gemini only fills categories OSM has no tag for.
    const facilities = mergeFacilities(osmFacilities, extractFacilities(analysis));

    const newNoise    = analysis.noise_score    / 2;
    const newLighting = analysis.lighting_score / 2;
    const newCrowd    = analysis.crowd_score    / 2;

    // Reject invalid scores — Gemini occasionally returns 0 which is outside the 1-10 range
    if (newNoise < 0.5 || newLighting < 0.5 || newCrowd < 0.5) {
        // Scores are unusable, but the (deterministic, Gemini-independent) OSM facilities are
        // still worth saving rather than discarding along with the bad score analysis.
        if (osmFacilities) {
            await prisma.location.update({
                where: { id: location.id },
                data: { ...(yelpId && { externalYelpId: yelpId }), estimatedFacilities: osmFacilities, lastEnrichedAt: new Date() },
            });
        }
        return { updated: false, reason: "invalid_scores" };
    }

    if (!scoresDiffer(location, newNoise, newLighting, newCrowd)) {
        await prisma.location.update({
            where: { id: location.id },
            data: {
                ...(yelpId && { externalYelpId: yelpId }),
                ...(facilities && { estimatedFacilities: facilities }),
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
            ...(facilities && { estimatedFacilities: facilities }),
            dataSource:             sources.join(",") || "category",
            lastEnrichedAt:         new Date(),
        },
    });

    await prisma.enrichmentLog.create({
        data: { locationId: location.id, scores: { noise: newNoise, lighting: newLighting, crowd: newCrowd, sources } },
    });

    return { updated: true, noise: newNoise, lighting: newLighting, crowd: newCrowd };
}

export async function runEnrichment({ force = false } = {}) {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_HOURS * 60 * 60 * 1000);

    const locations = await prisma.location.findMany({
        // force=true (manual backfill trigger) ignores staleness and the nightly cap, re-processing
        // every location — used e.g. to seed estimatedFacilities onto locations enriched before
        // that field existed. An unforced (cron) run processes at most NIGHTLY_BATCH_LIMIT of the
        // oldest-stale locations, so a backlog trickles in over several nights instead of spiking
        // API spend in one run.
        where: force ? {} : { OR: [{ lastEnrichedAt: null }, { lastEnrichedAt: { lt: cutoff } }] },
        orderBy: [{ lastEnrichedAt: { sort: "asc", nulls: "first" } }],
        ...(force ? {} : { take: NIGHTLY_BATCH_LIMIT }),
        select: {
            id: true, name: true, latitude: true, longitude: true,
            category: true, externalYelpId: true, googlePlaceId: true,
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
