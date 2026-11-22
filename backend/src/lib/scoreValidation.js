// Shared by the nightly cron (lib/enrichmentCron.js) and POST /enrichment/location so both
// writers accept exactly the same thing from Gemini.

/** A raw Gemini score is usable only if it is a real, finite number in 1-10. Strings (even "7"),
 *  null, undefined, NaN, Infinity, 0 and anything above 10 are all rejected — never coerced. */
export function isValidRawScore(v) {
    return typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 10;
}

/**
 * Validates the three raw 1-10 scores and converts them to the app's 0.5-5 scale.
 * Returns { ok: true, noise, lighting, crowd } or { ok: false, reason: "invalid_scores" }.
 */
export function validateScores(analysis) {
    const { noise_score, lighting_score, crowd_score } = analysis ?? {};
    if (![noise_score, lighting_score, crowd_score].every(isValidRawScore)) {
        return { ok: false, reason: "invalid_scores" };
    }
    return { ok: true, noise: noise_score / 2, lighting: lighting_score / 2, crowd: crowd_score / 2 };
}
