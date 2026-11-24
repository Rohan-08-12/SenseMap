import express from "express";
import rateLimit from "express-rate-limit";
import prisma from "../lib/prisma.js";
import cloudinary from "../lib/cloudinary.js";
import { generateAudioSummary } from "../lib/elevenlabs.js";
import { buildAudioScript, audioAvailability, audioPublicId, isAudioCacheValid, NO_AUDIO_MESSAGE } from "../lib/audioScript.js";
import { displayScoreForLocation } from "../lib/scores.js";
import { hasTrustworthyScores } from "../lib/trustworthyScores.js";
import { summarizeReviewSources } from "../lib/systemBot.js";

const router = express.Router();

// Only counts against the limit when ElevenLabs is actually called (not cache hits)
const generationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Audio generation limit reached. Try again later." },
});

// GET /audio/:locationId — return cached or freshly generated audio URL
router.get("/:locationId", async (req, res) => {
  const { locationId } = req.params;

  try {
    const location = await prisma.location.findUnique({
      where: { id: locationId },
      include: {
        sensoryScores: true,
        reviews: { select: { isAiGenerated: true, user: { select: { email: true, auth0Id: true } } } },
      },
    });

    if (!location) return res.status(404).json({ error: "Location not found" });

    // Same scores the place panel shows. Nothing usable (or an AI guess with no signal) -> no audio at all,
    // decided BEFORE the cache so a stale file made from the old hardcoded fallback is never served.
    const display = displayScoreForLocation(location);
    const availability = audioAvailability(display, !hasTrustworthyScores(display, location.enrichmentConfidence ?? null));
    if (!availability.available) {
      return res.json({ available: false, reason: availability.reason, audioUrl: null, message: NO_AUDIO_MESSAGE });
    }

    // Serve cached audio only if it came from the current script version and is newer than the last update
    if (isAudioCacheValid(location)) {
      return res.json({ available: true, audioUrl: location.audioUrl });
    }

    // Apply rate limit only for generation calls (not cache hits)
    const limited = await new Promise((resolve) => generationLimiter(req, res, resolve));
    if (res.headersSent) return;
    void limited;

    // Generate fresh audio
    const script = buildAudioScript(location, display, { realReviews: summarizeReviewSources(location.reviews).real }, null);

    let audioBuffer;
    try {
      audioBuffer = await generateAudioSummary(script);
    } catch (err) {
      console.error("ElevenLabs generation failed:", err);
      return res.status(503).json({ audioUrl: null, error: "Audio unavailable" });
    }

    // Upload to Cloudinary as audio (resource_type: "video" handles audio files)
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: "video",
          folder: "sensemap-audio",
          public_id: audioPublicId(locationId),
          overwrite: true,
        },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      uploadStream.end(audioBuffer);
    });

    await prisma.location.update({
      where: { id: locationId },
      data: {
        audioUrl: uploadResult.secure_url,
        audioGeneratedAt: new Date(),
      },
    });

    res.json({ available: true, audioUrl: uploadResult.secure_url });
  } catch (error) {
    console.error("Audio route error:", error);
    res.status(503).json({ audioUrl: null, error: "Audio unavailable" });
  }
});

export default router;
