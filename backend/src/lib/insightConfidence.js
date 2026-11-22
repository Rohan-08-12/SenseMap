import { MIN_ENRICHMENT_CONFIDENCE } from "./enrichmentAnalysis.js";

// Same threshold as enrichment gating (4/10), on the insights endpoint's 0-100 scale.
export const MIN_INSIGHT_CONFIDENCE = MIN_ENRICHMENT_CONFIDENCE * 10;

export const LOW_CONFIDENCE_NOTE =
    "Low confidence: there isn't enough information about this place to describe its noise, lighting or crowds reliably.";

export const isLowInsightConfidence = (c) => !(typeof c === "number" && Number.isFinite(c) && c >= MIN_INSIGHT_CONFIDENCE);

/**
 * If the model's own confidence is below the threshold (or missing), strip everything that would
 * present a guess as a finding: the sensory summaries and scores, best time, tags and preparation
 * tips. Returns a new object with lowConfidence: true and a plain-language note; otherwise returns
 * the input unchanged with lowConfidence: false.
 */
export function applyInsightConfidence(parsed) {
    if (!isLowInsightConfidence(parsed?.confidence)) return { ...parsed, lowConfidence: false };
    return {
        ...parsed,
        lowConfidence: true,
        lowConfidenceNote: LOW_CONFIDENCE_NOTE,
        noise:    { score: null, summary: null },
        lighting: { score: null, summary: null },
        crowd:    { score: null, summary: null },
        bestTime: "",
        tags: [],
        preparationGuide: [],
    };
}
