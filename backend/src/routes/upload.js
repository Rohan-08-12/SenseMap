import express from "express";
import multer from "multer";
import cloudinary from "../lib/cloudinary.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed"));
        }
    },
});

// POST /upload — upload image to Cloudinary (protected)
router.post("/", requireAuth, syncUser, upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image provided" });

        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                { folder: "sensorysafe" },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            ).end(req.file.buffer);
        });

        res.json({ imageUrl: result.secure_url });
    } catch (error) {
        if (error.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File too large. Maximum size is 5MB." });
        }
        if (error.message === "Only image files are allowed") {
            return res.status(400).json({ error: error.message });
        }
        console.error("Upload error:", error);
        res.status(500).json({ error: "Upload failed" });
    }
});

export default router;