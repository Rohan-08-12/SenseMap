/**
 * Core Express Application Setup
 * This file configures middleware (like CORS) and registers all API routes.
 */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

// Import route handlers for different domains of the app
import locationsRoutes from "./routes/locations.js";
import reviewsRoutes from "./routes/reviews.js";
import profilesRoutes from "./routes/profiles.js";
import rankingsRoutes from "./routes/rankings.js";
import aiRoutes from "./routes/ai.js";
import uploadRoutes from "./routes/upload.js";
import savedPlacesRouter from "./routes/savedPlaces.js";
import discoverRouter from "./routes/discover.js";
import checkinsRouter from "./routes/checkins.js";

dotenv.config();

const app = express();

// Enable Cross-Origin Resource Sharing (CORS) to allow the frontend to communicate with the backend
app.use(cors());

// Parse incoming JSON payloads automatically
app.use(express.json());

// Basic health check endpoint
app.get("/", (req, res) => {
    res.json({ status: 'SensorySafe backend running' });
});

// Register all grouped API routes under their respective base paths
app.use("/locations", locationsRoutes);
app.use("/reviews", reviewsRoutes);
app.use("/profiles", profilesRoutes);
app.use("/rankings", rankingsRoutes);
app.use("/ai", aiRoutes);
app.use("/upload", uploadRoutes);
app.use("/saved-places", savedPlacesRouter);
app.use("/discover", discoverRouter);
app.use("/checkins", checkinsRouter);

export default app;