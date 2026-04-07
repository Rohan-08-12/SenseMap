import express from "express";
import { toGeoJSON } from "../lib/geojson.js";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";


const router = express.Router()

/**
 * GET /locations
 * Returns all locations formatted as a GeoJSON FeatureCollection.
 * Used for rendering global map pins.
 */
router.get("/", async (req, res) => {
    try {
        const locations = await prisma.location.findMany({
            include: {
                sensoryScores: true,
            }
        });
        res.json(toGeoJSON(locations));
    } catch (error) {
        console.error("Full error:", JSON.stringify(error, null, 2));
        res.status(500).json({ error: error.message });
    }
})


/**
 * GET /locations/heatmap
 * Fetches a lightweight subset of location data to render the Deck.gl map overlay.
 * Filters out invalid coordinates and formats the data for efficient map rendering.
 */
router.get("/heatmap", async (req, res) => {
    try {
        const locations = await prisma.location.findMany({
            take: 500,
            select: {
                id: true,
                name: true,
                category: true,
                latitude: true,
                longitude: true,
                sensoryScores: {
                    select: {
                        noiseScore: true,
                        lightingScore: true,
                        crowdScore: true,
                        comfortScore: true,
                        reviewCount: true,
                    }
                }
            }
        });

        const heatMapData = locations
            .filter(loc => loc.latitude != null && loc.longitude != null)
            .map((loc) => {
                const s = loc.sensoryScores;
                return {
                    locationId: loc.id,
                    longitude: loc.longitude,
                    latitude: loc.latitude,
                    name: loc.name,
                    category: loc.category,
                    noiseScore: s?.noiseScore ?? null,
                    lightingScore: s?.lightingScore ?? null,
                    crowdScore: s?.crowdScore ?? null,
                    comfortScore: s?.comfortScore ?? null,
                    reviewCount: s?.reviewCount ?? 0,
                };
            });

        res.json(heatMapData);
    } catch (error) {
        console.error("Full error:", JSON.stringify(error, null, 2));
        res.status(500).json({ error: error.message });
    }
})

/**
 * GET /locations/match
 * Protected route: Calculates a personalized "Match Score" for the logged-in user.
 * Compares the user's stored sensory tolerances (noise, lighting, crowds) 
 * against the aggregated community scores for each location.
 */
router.get("/match", requireAuth, syncUser, async (req, res) => {
    try {
        const auth0Id = req.auth.payload.sub;

        const user = await prisma.user.findUnique({
            where: { auth0Id },
            include: { sensoryProfile: true }
        });

        if (!user) return res.status(404).json({ error: "User not found" });
        if (!user.sensoryProfile) return res.status(404).json({ error: "Sensory profile not found" });

        const { noiseTolerance, lightingTolerance, crowdTolerance } = user.sensoryProfile;

        const locations = await prisma.location.findMany({
            include: { sensoryScores: true }
        });

        const matches = locations
            .filter(loc => loc.sensoryScores)
            .map(loc => {
                const s = loc.sensoryScores;

                // calculate match: how close is location score to user tolerance (both 1-5)
                const noiseMatch = 100 - Math.abs(s.noiseScore - noiseTolerance) * 20;
                const lightingMatch = 100 - Math.abs(s.lightingScore - lightingTolerance) * 20;
                const crowdMatch = 100 - Math.abs(s.crowdScore - crowdTolerance) * 20;
                const matchScore = Math.round((noiseMatch + lightingMatch + crowdMatch) / 3);

                return {
                    locationId: loc.id,
                    name: loc.name,
                    category: loc.category,
                    address: loc.address,
                    longitude: loc.longitude,
                    latitude: loc.latitude,
                    matchScore,
                    noiseScore: s.noiseScore,
                    lightingScore: s.lightingScore,
                    crowdScore: s.crowdScore,
                    comfortScore: s.comfortScore,
                };
            })
            .sort((a, b) => b.matchScore - a.matchScore);

        res.json(matches);
    } catch (error) {
        console.error("Error calculating matches:", error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /locations/search?q=
 * Public search endpoint. Searches location names, categories, addresses, and descriptions.
 * Returns results in GeoJSON format for direct map integration.
 */
router.get("/search", async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) return res.status(400).json({ error: "Query parameter q is required" });

        const locations = await prisma.location.findMany({
            where: {
                OR: [
                    { name: { contains: q, mode: "insensitive" } },
                    { category: { contains: q, mode: "insensitive" } },
                    { address: { contains: q, mode: "insensitive" } },
                    { description: { contains: q, mode: "insensitive" } },
                ]
            },
            include: { sensoryScores: true }
        });

        res.json(toGeoJSON(locations));
    } catch (error) {
        console.error("Error searching locations:", error);
        res.status(500).json({ error: error.message });
    }
});


/**
 * GET /locations/:id
 * Fetches full details for a specific location including its sensory scores
 * and the 10 most recent community reviews.
 */
router.get("/:id", async (req, res) => {
    try {
        const location = await prisma.location.findUnique({
            where: { id: req.params.id },
            include: {
                sensoryScores: true,
                reviews: {
                    orderBy: { createdAt: "desc" },
                    take: 10,
                }
            }
        });

        if (!location) return res.status(404).json({ error: "Location not found" });

        res.json(location);
    } catch (error) {
        console.error("Error fetching location:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;