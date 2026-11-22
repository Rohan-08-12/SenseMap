import { isLowConfidence } from "./scores.js";

export const NO_INSIGHT_DATA_MESSAGE = "No review or public data is available for this location yet.";

/**
 * The text POST /ai/insights/:locationId analyses: visitor/curated review text, else (for AI-estimated
 * places) freshly fetched public-source text. Returns "" when there is none, and the route then answers
 * without calling Gemini or Claude.
 *
 * The live fetch hits several external sources one after another (this was the ~9.6 s in the slow 400s), so
 * it is skipped for a low-confidence estimate (all three factors at the 0.5 floor): the earlier enrichment
 * already found nothing to go on there.
 */
export async function gatherInsightText(location, { fetchSources, log = console.log } = {}) {
    const fromReviews = (location.reviews ?? [])
        .filter((r) => r.bodyText && r.bodyText.trim().length > 0)
        .map((r) => `${r.visitTime ? `[${r.visitTime}] ` : ""}${r.bodyText}`)
        .join("\n");
    if (fromReviews) return fromReviews;

    if (location.estimatedNoiseScore == null) return "";
    const lowConfidence = isLowConfidence({
        source: "estimated",
        noise: location.estimatedNoiseScore,
        lighting: location.estimatedLightingScore,
        crowd: location.estimatedCrowdScore,
    });
    if (lowConfidence) return "";

    const started = Date.now();
    const { combinedText } = await fetchSources({
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        existingYelpId: location.externalYelpId,
    });
    log(`[insights] live source fetch for ${location.id} took ${Date.now() - started}ms, ${combinedText ? "found text" : "found nothing"}`);
    return combinedText || "";
}
