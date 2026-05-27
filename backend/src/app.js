import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

import locationsRoutes from "./routes/locations.js";
import reviewsRoutes from "./routes/reviews.js";
import profilesRoutes from "./routes/profiles.js";
import rankingsRoutes from "./routes/rankings.js";
import aiRoutes from "./routes/ai.js";
import uploadRoutes from "./routes/upload.js";
import savedPlacesRouter from "./routes/savedPlaces.js";
import discoverRouter from "./routes/discover.js";
import checkinsRouter from "./routes/checkins.js";
import usersRouter from "./routes/users.js";
import audioRouter from "./routes/audio.js";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).filter(Boolean)
    : ["http://localhost:5173", "http://localhost:5174"];

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
}));

app.use(express.json({ limit: "1mb" }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
});

const reviewLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Review submission limit reached, please try again later." },
});

const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "AI request limit reached, please slow down." },
});

const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Upload limit reached. You can upload up to 10 images per hour." },
});

const discoverLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Search limit reached, please slow down." },
});

// Claude cross-validation adds ~$0.003/call — cap tightly
const claudeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "AI request limit reached, please slow down." },
});

// ElevenLabs TTS is billed per character — limit per IP
const audioLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Audio generation limit reached. Try again later." },
});

app.use(apiLimiter);

app.get("/", (req, res) => {
    res.json({ status: "ok" });
});

app.use("/locations", locationsRoutes);
app.use("/reviews", reviewLimiter, reviewsRoutes);
app.use("/profiles", profilesRoutes);
app.use("/rankings", rankingsRoutes);
app.use("/ai", aiLimiter, claudeLimiter, aiRoutes);
app.use("/upload", uploadLimiter, uploadRoutes);
app.use("/saved-places", savedPlacesRouter);
app.use("/discover", discoverLimiter, discoverRouter);
app.use("/checkins", checkinsRouter);
app.use("/users", usersRouter);
app.use("/audio", audioLimiter, audioRouter);

// Global error handler — converts auth errors and uncaught throws to clean JSON
app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status === 401) return res.status(401).json({ error: "Unauthorized" });
    if (status === 403) return res.status(403).json({ error: "Forbidden" });
    console.error("Unhandled error:", err);
    res.status(status).json({ error: "Internal server error" });
});

export default app;