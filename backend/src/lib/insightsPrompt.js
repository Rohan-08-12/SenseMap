// Prompt + response schema for POST /ai/insights/:locationId, shared with scripts/dry_run_enrichment.js
// so a dry run exercises exactly what the route sends to Gemini.

export const insightsSchema = {
  type: "object",
  properties: {
    confidence: { type: "number", description: "0-100 confidence in analysis based on review quantity and quality" },
    noise: {
      type: "object",
      properties: {
        score:   { type: "number", description: "Noise level 1-5, where 1=silent and 5=very loud" },
        summary: { type: "string", description: "One sentence describing the noise environment" },
      },
      required: ["score", "summary"],
    },
    lighting: {
      type: "object",
      properties: {
        score:   { type: "number", description: "Lighting intensity 1-5, where 1=dim and 5=harsh" },
        summary: { type: "string", description: "One sentence describing the lighting environment" },
      },
      required: ["score", "summary"],
    },
    crowd: {
      type: "object",
      properties: {
        score:   { type: "number", description: "Crowd density 1-5, where 1=empty and 5=packed" },
        summary: { type: "string", description: "One sentence describing crowd levels" },
      },
      required: ["score", "summary"],
    },
    bestTime:         { type: "string",  description: "Short phrase only, max 6 words, e.g. 'Mid-morning or late afternoon' or 'Weekday mornings'. No full sentences." },
    sentiment:        { type: "string",  enum: ["positive", "neutral", "negative"] },
    tags:             { type: "array",   items: { type: "string" }, description: "Short sensory descriptor tags" },
    preparationGuide: { type: "array",   items: { type: "string" }, description: "Practical sensory preparation tips" },
  },
  required: ["confidence", "noise", "lighting", "crowd", "bestTime", "sentiment", "tags", "preparationGuide"],
};

export function buildInsightsPrompt(location, reviewTexts) {
    return `You are a sensory analysis assistant helping autistic and sensory-sensitive people find comfortable public spaces.

Analyze the available information for "${location.name}" (category: ${location.category ?? "unknown"}) and produce a structured sensory profile.

Base every statement only on the data below. Do not present guesses as findings. If the data says nothing about noise, lighting or crowds, say so plainly in that summary (for example "No information available about noise.") instead of inventing details, and keep scores neutral. You may mention what is typical for this kind of place only if you clearly label it as a general expectation for the category, not something known about this place. Set confidence low (below 40) when the data contains little or no specific sensory information, and higher (60-90) only when specific sensory signals are present.

Available data:
${reviewTexts}`;
}
