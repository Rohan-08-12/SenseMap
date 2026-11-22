// Gemini schema + prompt + interpretation shared by the nightly cron and POST /enrichment/location,
// so the two writers can't drift apart again.
import { FACILITIES_OPTIONS } from "./facilitiesOptions.js";
import { validateScores } from "./scoreValidation.js";

export const analyzeSchema = {
    type: "object",
    properties: {
        // null = "the text has no real information about this" — never a guess.
        noise_score:    { type: "number", nullable: true, description: "Noise level 1-10, where 1=silent and 10=extremely loud. null if the text gives no real evidence about noise." },
        lighting_score: { type: "number", nullable: true, description: "Lighting intensity 1-10, where 1=dim and 10=harsh/bright. null if the text gives no real evidence about lighting." },
        crowd_score:    { type: "number", nullable: true, description: "Crowd density 1-10, where 1=empty and 10=packed. null if the text gives no real evidence about crowds." },
        confidence:     { type: "number", description: "0-10: how much real sensory evidence the text contains (0 = none, 10 = detailed and consistent)." },
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

export function buildAnalysisPrompt(name, text) {
    return `You are a sensory analysis assistant for autistic and sensory-sensitive people.

Analyze these reviews for "${name}" and extract structured sensory scores.

Important: the text below may contain no real sensory information (for example only a star rating or a one-line description). Score a factor only when the text gives actual evidence about it. If it does not, return null for that score — do NOT guess, and do not fall back to a middle value or to 1. Set confidence (0-10) to reflect how much real sensory evidence the text contains; use 0 when there is none.

Also infer, where the text gives any signal, the facility characteristics below — only include tags the text actually supports; leave a category's array empty if there's no signal for it. Use only the exact option strings listed (no new values):
- temperature_tags, from: ${FACILITIES_OPTIONS.temperature.join(", ")}
- seating_tags, from: ${FACILITIES_OPTIONS.seating.join(", ")}
- bathroom_tags, from: ${FACILITIES_OPTIONS.bathrooms.join(", ")}
- social_interaction_tags, from: ${FACILITIES_OPTIONS.socialInteractions.join(", ")}

Reviews:
${text}`;
}

// Below this confidence (0-10) the estimates are not stored.
export const MIN_ENRICHMENT_CONFIDENCE = 4;

const validConfidence = (c) => (typeof c === "number" && Number.isFinite(c) && c >= 0 && c <= 10 ? c : null);

/**
 * Turns Gemini's parsed JSON into a decision.
 *  { action: "write", noise, lighting, crowd, confidence }  -> store the (0.5-5) estimates
 *  { action: "skip",  reason, confidence }                  -> do NOT write estimates
 * `confidence` is the model's 0-10 value, or null if it was missing/invalid.
 * Skip reasons: no_sensory_signal (all three scores null), incomplete_scores (some null — a partial
 * estimate is never stored), invalid_scores (bad type/range), invalid_confidence (missing or not a
 * number in 0-10), low_confidence (< MIN_ENRICHMENT_CONFIDENCE).
 */
export function interpretAnalysis(analysis) {
    const confidence = validConfidence(analysis?.confidence);
    const raw = [analysis?.noise_score, analysis?.lighting_score, analysis?.crowd_score];
    if (raw.every((v) => v === null)) return { action: "skip", reason: "no_sensory_signal", confidence };
    if (raw.some((v) => v === null)) return { action: "skip", reason: "incomplete_scores", confidence };
    const validated = validateScores(analysis);
    if (!validated.ok) return { action: "skip", reason: validated.reason, confidence };
    if (confidence === null) return { action: "skip", reason: "invalid_confidence", confidence };
    if (confidence < MIN_ENRICHMENT_CONFIDENCE) return { action: "skip", reason: "low_confidence", confidence };
    return { action: "write", noise: validated.noise, lighting: validated.lighting, crowd: validated.crowd, confidence };
}

/**
 * Row update for a skipped result, or null if there is nothing to save. enrichmentConfidence is
 * always stored when the model gave a valid one, so affected rows can be found later. Note it then
 * describes the LATEST attempt, which for a gated result is not the confidence of any stored scores.
 * Definite "nothing reliable here" answers (no signal / incomplete scores / low confidence) mark the place
 * enriched so it is not retried every night (incomplete_scores additionally backs off for 30 days, see
 * enrichmentBackoff.js); malformed output is only marked when OSM facilities were saved, as before.
 */
export function skipUpdateData(decision, { yelpId, osmFacilities }) {
    const markEnriched = ["no_sensory_signal", "incomplete_scores", "low_confidence"].includes(decision.reason) || !!osmFacilities;
    const data = {
        ...(yelpId && { externalYelpId: yelpId }),
        ...(osmFacilities && { estimatedFacilities: osmFacilities }),
        ...(decision.confidence != null && { enrichmentConfidence: decision.confidence }),
        ...(markEnriched && { lastEnrichedAt: new Date() }),
    };
    return Object.keys(data).length > 0 ? data : null;
}

/** A Gemini call that threw (network, quota, bad key, retired model, blocked) or returned unparseable JSON. */
export class GeminiRequestError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = "GeminiRequestError";
        this.cause = cause;
    }
}

/** The one Gemini request both writers (and scripts/dry_run_enrichment.js) make. Returns the parsed JSON.
 *  Any failure is rethrown as a GeminiRequestError so a run can tell Gemini outages from other errors. */
export async function requestAnalysis(model, name, text) {
    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: buildAnalysisPrompt(name, text) }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: analyzeSchema },
        });
        return JSON.parse(result.response.text());
    } catch (err) {
        throw new GeminiRequestError(err?.message ?? String(err), err);
    }
}
