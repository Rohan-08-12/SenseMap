import express from "express";
import rateLimit from "express-rate-limit";
import prisma from "../lib/prisma.js";
import cloudinary from "../lib/cloudinary.js";
import { generateAudioSummary } from "../lib/elevenlabs.js";
import { buildAudioScript } from "../lib/audioScript.js";

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
      include: { sensoryScores: true },
    });

    if (!location) return res.status(404).json({ error: "Location not found" });

    // Serve cached audio if it was generated after the location was last updated
    if (
      location.audioUrl &&
      location.audioGeneratedAt &&
      location.audioGeneratedAt > location.updatedAt
    ) {
      return res.json({ audioUrl: location.audioUrl });
    }

    // Apply rate limit only for generation calls (not cache hits)
    const limited = await new Promise((resolve) => generationLimiter(req, res, resolve));
    if (res.headersSent) return;
    void limited;

    // Generate fresh audio
    const script = buildAudioScript(location, location.sensoryScores, null);

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
          public_id: `audio_${locationId}`,
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

    res.json({ audioUrl: uploadResult.secure_url });
  } catch (error) {
    console.error("Audio route error:", error);
    res.status(503).json({ audioUrl: null, error: "Audio unavailable" });
  }
});

export default router;
