import { embeddingModel } from "./gemini.js";

/**
 * Builds a rich sensory description of a location and returns its embedding vector.
 * The text is designed to capture sensory-specific language so similar spaces
 * cluster together in embedding space.
 */
export async function generateLocationEmbedding(location, insights) {
    const text = [
        `${location.name}, a ${location.category ?? "place"} located at ${location.address ?? "unknown address"}.`,
        `Noise: ${insights.noise.summary} (score ${insights.noise.score}/5).`,
        `Lighting: ${insights.lighting.summary} (score ${insights.lighting.score}/5).`,
        `Crowds: ${insights.crowd.summary} (score ${insights.crowd.score}/5).`,
        `Best time to visit: ${insights.bestTime}`,
        `Sensory tags: ${insights.tags.join(", ")}.`,
    ].join(" ");

    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
}

export function cosineSimilarity(a, b) {
    const len = Math.min(a.length, b.length);
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < len; i++) {
        dot  += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}
