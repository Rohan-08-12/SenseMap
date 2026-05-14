import express from "express";
import { model } from "../lib/gemini.js";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";
import { generateLocationEmbedding } from "../lib/embeddings.js";
const router = express.Router();

router.get("/", (req, res) => {
  res.json({ message: "ai route live" });
});

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

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: analyzeSchema },
    });
    res.json(JSON.parse(result.response.text()));
  } catch (error) {
    console.error("AI analyze error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /ai/insights/:locationId — full AI insight card for a location
router.post("/insights/:locationId", requireAuth, syncUser, async (req, res) => {
  try {
    const { locationId } = req.params;

    // get locations + all reviews
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: { reviews: true }
    })

    if (!location) return res.status(404).json({ error: "Location not found" });
    if (location.reviews.length === 0) return res.status(400).json({ error: "Location has no reviews" });

    // Only include reviews that have actual text — blank quick-ratings add no signal
    const reviewsWithText = location.reviews.filter((r) => r.bodyText && r.bodyText.trim().length > 0);
    if (reviewsWithText.length === 0) return res.status(400).json({ error: "No text reviews yet" });

    const reviewTexts = reviewsWithText.map((r) => {
      const timeTag = r.visitTime ? `[${r.visitTime}] ` : "";
      return `${timeTag}${r.bodyText}`;
    }).join("\n");

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
        bestTime:         { type: "string",  description: "One sentence recommending the best time to visit" },
        sentiment:        { type: "string",  enum: ["positive", "neutral", "negative"] },
        tags:             { type: "array",   items: { type: "string" }, description: "Short sensory descriptor tags" },
        preparationGuide: { type: "array",   items: { type: "string" }, description: "Practical sensory preparation tips" },
      },
      required: ["confidence", "noise", "lighting", "crowd", "bestTime", "sentiment", "tags", "preparationGuide"],
    };

    const prompt = `You are a sensory analysis assistant helping autistic and sensory-sensitive people find comfortable public spaces.

Analyze these reviews for "${location.name}" and produce a structured sensory profile with scores (1-5), summaries, best visit time, sentiment, descriptor tags, and practical preparation tips.

Reviews:
${reviewTexts}`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: insightsSchema },
    });
    const parsed = JSON.parse(result.response.text());

    // Generate and store embedding in the background — non-fatal if it fails
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