import express from "express";
import { model } from "../lib/gemini.js";
import { validateWithClaude } from "../lib/anthropic.js";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";
import { generateLocationEmbedding } from "../lib/embeddings.js";
import { fetchAllSources } from "../services/scraper.js";
const router = express.Router();


const analyzeSchema = {
  type: "object",
  properties: {
    noise_score:     { type: "number",  description: "Noise level 1-10, where 1=silent and 10=extremely loud" },
    lighting_score:  { type: "number",  description: "Lighting intensity 1-10, where 1=dim and 10=harsh/bright" },
    crowd_score:     { type: "number",  description: "Crowd density 1-10, where 1=empty and 10=packed" },
    sentiment:       { type: "string",  enum: ["positive", "neutral", "negative"] },
    tags:            { type: "array",   items: { type: "string" }, description: "Short sensory descriptor tags" },
    summary:         { type: "string",  description: "One-sentence sensory summary of the space" },
  },
  required: ["noise_score", "lighting_score", "crowd_score", "sentiment", "tags", "summary"],
};

function blendScores(geminiScores, claudeScores) {
  if (!claudeScores) return { ...geminiScores, validationSource: "gemini" };

  const dims = ["noise_score", "lighting_score", "crowd_score"];
  const blended = { ...geminiScores, validationSource: "gemini+claude" };

  for (const dim of dims) {
    const g = geminiScores[dim];
    const c = claudeScores[dim];
    if (g == null || c == null) continue;

    if (Math.abs(g - c) > 2) {
      const claudeConf = claudeScores.confidence ?? 5;
      const geminiConf = 7;
      const totalConf = claudeConf + geminiConf;
      blended[dim] = (g * geminiConf + c * claudeConf) / totalConf;
    } else {
      blended[dim] = (g + c) / 2;
    }
  }

  blended.confidence = claudeScores.confidence ?? null;
  return blended;
}

// POST /ai/analyze — analyze review text for sensory signals (protected)
router.post("/analyze", requireAuth, syncUser, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") return res.status(400).json({ error: "Text is required" });
    if (text.length > 5000) return res.status(400).json({ error: "Text must be under 5000 characters" });

    const prompt = `You are a sensory analysis assistant helping autistic and sensory-sensitive people evaluate public spaces.

Analyze this review and extract structured sensory scores (1-10 scales), sentiment, tags, and a brief summary.

Review:
${text}`;

    // Run Gemini and Claude in parallel
    const [geminiResult, claudeResult] = await Promise.all([
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: analyzeSchema },
      }),
      validateWithClaude(text),
    ]);

    const geminiParsed = JSON.parse(geminiResult.response.text());
    const blended = blendScores(geminiParsed, claudeResult);

    res.json(blended);
  } catch (error) {
    console.error("AI analyze error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /ai/insights/:locationId — full AI insight card for a location
router.post("/insights/:locationId", requireAuth, syncUser, async (req, res) => {
  try {
    const { locationId } = req.params;

    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: { reviews: true }
    })

    if (!location) return res.status(404).json({ error: "Location not found" });

    const reviewsWithText = location.reviews.filter((r) => r.bodyText && r.bodyText.trim().length > 0);

    let reviewTexts = reviewsWithText.map((r) => {
      const timeTag = r.visitTime ? `[${r.visitTime}] ` : "";
      return `${timeTag}${r.bodyText}`;
    }).join("\n");

    // No community reviews — fall back to Yelp/Foursquare/Reddit enrichment text
    if (!reviewTexts && location.estimatedNoiseScore != null) {
      const { combinedText } = await fetchAllSources({
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        existingYelpId: location.externalYelpId,
      });
      reviewTexts = combinedText;
    }

    if (!reviewTexts) return res.status(400).json({ error: "No review data available for this location" });

    const insightsSchema = {
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

    const prompt = `You are a sensory analysis assistant helping autistic and sensory-sensitive people find comfortable public spaces.

Analyze the available information for "${location.name}" (category: ${location.category ?? "unknown"}) and produce a structured sensory profile.

Use the data below as your primary source. If specific sensory details are missing, make reasonable category-based estimates — for example, cafes tend to have moderate-to-high noise, bright lighting, and variable crowds; libraries tend to be quiet with soft lighting; parks tend to have natural light and low indoor crowds. Always produce useful estimates rather than saying "no information available". Set confidence lower (20-40) when relying mostly on category inference, and higher (60-90) when specific sensory signals are present.

Available data:
${reviewTexts}`;

    // Run Gemini and Claude cross-validation in parallel
    // Wrap Gemini separately — it can fail on very short/low-quality text, return 400 not 500
    let geminiResult, claudeResult;
    try {
      [geminiResult, claudeResult] = await Promise.all([
        model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: insightsSchema },
        }),
        validateWithClaude(reviewTexts),
      ]);
    } catch (geminiErr) {
      console.error("Gemini insights error:", geminiErr.message);
      return res.status(400).json({ error: "Not enough data to generate insights for this location" });
    }

    const parsed = JSON.parse(geminiResult.response.text());

    if (claudeResult) {
      const dims = [
        { geminiKey: "noise",     claudeKey: "noise_score"     },
        { geminiKey: "lighting",  claudeKey: "lighting_score"  },
        { geminiKey: "crowd",     claudeKey: "crowd_score"     },
      ];

      for (const { geminiKey, claudeKey } of dims) {
        if (!parsed[geminiKey] || claudeResult[claudeKey] == null) continue;
        const g = parsed[geminiKey].score;
        const c = claudeResult[claudeKey] / 2;
        if (Math.abs(g - c) > 1) {
          const claudeConf = (claudeResult.confidence ?? 5) / 10;
          const geminiConf = 0.7;
          const total = claudeConf + geminiConf;
          parsed[geminiKey].score = (g * geminiConf + c * claudeConf) / total;
        } else {
          parsed[geminiKey].score = (g + c) / 2;
        }
      }

      parsed.validationSource = "gemini+claude";
      parsed.claudeConfidence = claudeResult.confidence ?? null;
    } else {
      parsed.validationSource = "gemini";
    }

    generateLocationEmbedding(location, parsed)
      .then((embedding) => prisma.location.update({ where: { id: locationId }, data: { embedding } }))
      .catch((e) => console.error("Embedding generation failed:", e));

    res.json(parsed);
  } catch (error) {
    console.error("AI error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
