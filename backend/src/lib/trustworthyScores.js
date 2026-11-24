/**
 * ONE rule for "this place has scores we can show": hasTrustworthyScores().
 *
 * Dependency-free on purpose: frontend/src/trustworthyScores.js is a byte-for-byte copy of this file (a test fails
 * if they drift), so the server and the browser can never disagree. Used by rankings, heatmap, search/list GeoJSON,
 * the place panel (via GET /locations/:id), match %, audio and similar-places.
 *
 * Input is a *display score*, what getDisplayScore() returns: { noise, lighting, crowd, source }, on the 0.5-5 scale
 * (a visitor slider of 1-10 is halved; the AI floor is 1/10 = 0.5), source "community" | "estimated" | "category".
 *
 * RULE (all must hold):
 *  1. noise, lighting and crowd are each a real number in [0.5, 5]. null, undefined, NaN and 0 fail, so a missing score
 *     can never be shown as "0.0"; no real score can be 0 because the lowest possible value is 0.5.
 *  2. source is "community" (at least one visitor review) -> trustworthy.
 *  3. source is "estimated" (AI estimate, no reviews) -> trustworthy only if it is not the all-floor placeholder (all three
 *     factors <= 0.5, i.e. the model had no evidence) and, when the model's confidence was recorded, that confidence
 *     is >= 4 on its 0-10 scale (the same gate enrichment applies before storing an estimate).
 *  4. anything else, in particular source "category" (the static per-category defaults the OSM import wrote with
 *     reviewCount 0), is NOT trustworthy: those numbers are placeholders, not data about the place.
 */
export const MIN_SCORE = 0.5;
export const MAX_SCORE = 5;
export const MIN_ENRICHMENT_CONFIDENCE = 4;

const valid = (v) => typeof v === "number" && Number.isFinite(v) && v >= MIN_SCORE && v <= MAX_SCORE;

export function hasTrustworthyScores(display, enrichmentConfidence = null) {
    if (!display) return false;
    const { noise, lighting, crowd, source } = display;
    if (!valid(noise) || !valid(lighting) || !valid(crowd)) return false;
    if (source === "community") return true;
    if (source !== "estimated") return false;
    if (noise <= MIN_SCORE && lighting <= MIN_SCORE && crowd <= MIN_SCORE) return false;
    if (typeof enrichmentConfidence === "number" && enrichmentConfidence < MIN_ENRICHMENT_CONFIDENCE) return false;
    return true;
}
