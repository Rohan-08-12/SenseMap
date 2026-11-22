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

/**
 * Turns Gemini's parsed JSON into a decision.
 *  { action: "write", noise, lighting, crowd }  -> store the (0.5-5) estimates
 *  { action: "skip",  reason }                  -> do NOT write estimates
 * Reasons: no_sensory_signal (all three null: the model says the text has nothing),
 * incomplete_scores (some null — we never store a partial estimate), invalid_scores (bad type/range).
 */
export function interpretAnalysis(analysis) {
    const raw = [analysis?.noise_score, analysis?.lighting_score, analysis?.crowd_score];
    if (raw.every((v) => v === null)) return { action: "skip", reason: "no_sensory_signal" };
    if (raw.some((v) => v === null)) return { action: "skip", reason: "incomplete_scores" };
    const validated = validateScores(analysis);
    if (!validated.ok) return { action: "skip", reason: validated.reason };
    return { action: "write", noise: validated.noise, lighting: validated.lighting, crowd: validated.crowd };
}
