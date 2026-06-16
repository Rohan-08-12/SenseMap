import express from "express";
import { toGeoJSON } from "../lib/geojson.js";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { syncUser } from "../middleware/syncUser.js";
import { cosineSimilarity } from "../lib/embeddings.js";
import { getDisplayScore } from "../lib/scores.js";


const router = express.Router()

// Simple in-memory cache for 511 Ontario construction data (15-min TTL)
let constructionCache = { data: null, fetchedAt: 0 };
const CONSTRUCTION_TTL = 15 * 60 * 1000;

async function getConstructionProjects() {
  if (constructionCache.data && Date.now() - constructionCache.fetchedAt < CONSTRUCTION_TTL) {
    return constructionCache.data;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://511on.ca/api/v2/get/constructionprojects?format=json&lang=en', { signal: ctrl.signal });
    const data = await res.json();
    clearTimeout(timer);
    if (Array.isArray(data)) {
      constructionCache = { data, fetchedAt: Date.now() };
      return data;
    }
  } catch {
    clearTimeout(timer);
  }
  return constructionCache.data || [];
}

/**
 * GET /locations
 * Returns all locations formatted as a GeoJSON FeatureCollection.
 * Used for rendering global map pins.
 */
router.get("/", async (req, res) => {
    try {
        const locations = await prisma.location.findMany({
            take: 500,
            include: {
                sensoryScores: true,
            }
        });
        res.json(toGeoJSON(locations));
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
})


/**
 * GET /locations/heatmap
 * Fetches a lightweight subset of location data to render the Deck.gl map overlay.
 * Filters out invalid coordinates and formats the data for efficient map rendering.
 */
router.get("/heatmap", async (req, res) => {
    try {
        const clamp = (v) => v != null ? Math.min(5, Math.max(1, v)) : null;

        // Pull all locations with either community scores or AI-estimated scores
        const locations = await prisma.location.findMany({
            take: 500,
            where: {
                OR: [
                    { sensoryScores: { isNot: null } },
                    { estimatedNoiseScore: { not: null } },
                ],
            },
            select: {
                id: true,
                name: true,
                category: true,
                latitude: true,
                longitude: true,
                estimatedNoiseScore: true,
                estimatedLightingScore: true,
                estimatedCrowdScore: true,
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

        const heatMapData = locations.map((loc) => {
            const s = loc.sensoryScores;
            // Community scores when real reviews exist; AI-estimated next; OSM defaults last
            // Use || null to treat 0 as invalid (Gemini occasionally returns 0 outside valid range)
            const noise    = (s?.reviewCount > 0 ? s?.noiseScore    : null) || loc.estimatedNoiseScore || s?.noiseScore;
            const lighting = (s?.reviewCount > 0 ? s?.lightingScore : null) || loc.estimatedLightingScore || s?.lightingScore;
            const crowd    = (s?.reviewCount > 0 ? s?.crowdScore    : null) || loc.estimatedCrowdScore || s?.crowdScore;
            // Only use community comfortScore when real reviews exist; otherwise derive from sensory intensity
            // Guard nulls — JS coerces null to 0 in arithmetic, producing out-of-range scores
            const communityComfort = s?.reviewCount > 0 ? s?.comfortScore : null;
            const estimatedComfort = (noise != null && lighting != null && crowd != null)
                ? Math.min(5, Math.max(1, 6 - (noise + lighting + crowd) / 3))
                : null;
            const comfort = communityComfort ?? estimatedComfort;

            return {
                locationId: loc.id,
                longitude: loc.longitude,
                latitude: loc.latitude,
                name: loc.name,
                category: loc.category,
                noiseScore:    clamp(noise),
                lightingScore: clamp(lighting),
                crowdScore:    clamp(crowd),
                comfortScore:  clamp(comfort),
                reviewCount:   s?.reviewCount ?? 0,
            };
        });

        res.json(heatMapData);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: "Internal server error" });
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

        const { noiseTolerance = 3, lightingTolerance = 3, crowdTolerance = 3 } = user.sensoryProfile ?? {};

        const locations = await prisma.location.findMany({
            take: 500,
            include: { sensoryScores: true }
        });

        const safeScore = (score) => score != null ? score : 3;

        const matches = locations
            .map(loc => {
                const s = loc.sensoryScores;
                // Community scores when real reviews exist; AI-estimated next; OSM defaults last
                // Use || null to treat 0 as invalid (Gemini occasionally returns 0 outside valid range)
                const noise    = (s?.reviewCount > 0 ? s?.noiseScore    : null) || loc.estimatedNoiseScore || s?.noiseScore;
                const lighting = (s?.reviewCount > 0 ? s?.lightingScore : null) || loc.estimatedLightingScore || s?.lightingScore;
                const crowd    = (s?.reviewCount > 0 ? s?.crowdScore    : null) || loc.estimatedCrowdScore || s?.crowdScore;

                if (noise == null && lighting == null && crowd == null) return null;

                const noiseMatch    = Math.max(0, 100 - Math.abs(safeScore(noise)    - noiseTolerance)    * 25);
                const lightingMatch = Math.max(0, 100 - Math.abs(safeScore(lighting) - lightingTolerance) * 25);
                const crowdMatch    = Math.max(0, 100 - Math.abs(safeScore(crowd)    - crowdTolerance)    * 25);
                const matchScore    = Math.min(100, Math.max(0, Math.round((noiseMatch + lightingMatch + crowdMatch) / 3)));

                return {
                    locationId: loc.id,
                    name: loc.name,
                    category: loc.category,
                    address: loc.address,
                    longitude: loc.longitude,
                    latitude: loc.latitude,
                    matchScore,
                    noiseScore:    noise,
                    lightingScore: lighting,
                    crowdScore:    crowd,
                    comfortScore:  s?.comfortScore ?? null,
                };
            })
            .filter(Boolean)
            .sort((a, b) => b.matchScore - a.matchScore);

        res.json(matches);
    } catch (error) {
        console.error("Error calculating matches:", error);
        res.status(500).json({ error: "Internal server error" });
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

        // Build a set of search terms covering common plural/singular variations
        // so "cafes" matches "cafe" records and "cafe" matches "cafes" records.
        const terms = new Set([q]);
        const lower = q.toLowerCase();
        if (lower.endsWith('ies') && lower.length > 4) {
            terms.add(q.slice(0, -3) + 'y');   // libraries → library
        } else if (lower.endsWith('es') && lower.length > 3) {
            terms.add(q.slice(0, -2));           // cafes → cafe
        } else if (lower.endsWith('s') && lower.length > 2) {
            terms.add(q.slice(0, -1));           // parks → park
        } else {
            terms.add(q + 's');                  // cafe → cafes
        }

        const orClauses = [...terms].flatMap((term) => [
            { name: { contains: term, mode: "insensitive" } },
            { category: { contains: term, mode: "insensitive" } },
            { address: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
        ]);

        const locations = await prisma.location.findMany({
            where: { OR: orClauses },
            take: 100,
            include: { sensoryScores: true }
        });

        res.json(toGeoJSON(locations));
    } catch (error) {
        console.error("Error searching locations:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});


/**
 * GET /locations/similar/:id
 * Returns the top 5 locations most sensorially similar to the given location,
 * ranked by cosine similarity of their sensory embeddings.
 * Must be registered before /:id so Express doesn't consume "similar" as an id.
 */
router.get("/construction-check", async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.json({ nearby: false });
  try {
    const projects = await getConstructionProjects();
    const nearby = projects.some(
      (p) => p.Latitude && p.Longitude &&
        Math.abs(p.Latitude - lat) < 0.02 &&
        Math.abs(p.Longitude - lng) < 0.025
    );
    res.json({ nearby });
  } catch {
    res.json({ nearby: false });
  }
});

router.get("/similar/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const target = await prisma.location.findUnique({ where: { id } });
        if (!target) return res.status(404).json({ error: "Location not found" });
        if (!target.embedding || target.embedding.length === 0) {
            return res.json([]);
        }

        const candidates = await prisma.location.findMany({
            where: { id: { not: id } },
            take: 200,
            select: {
                id: true, name: true, category: true, address: true,
                latitude: true, longitude: true, imageUrl: true,
                embedding: true, sensoryScores: true,
            },
        });

        const results = candidates
            .filter((loc) => loc.embedding && loc.embedding.length > 0)
            .map((loc) => ({
                id: loc.id,
                name: loc.name,
                category: loc.category,
                address: loc.address,
                latitude: loc.latitude,
                longitude: loc.longitude,
                imageUrl: loc.imageUrl,
                sensoryScores: loc.sensoryScores,
                similarity: Math.round(cosineSimilarity(target.embedding, loc.embedding) * 100),
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 5);

        res.json(results);
    } catch (error) {
        console.error("Error fetching similar locations:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /locations/:id
 * Fetches full details for a specific location including its sensory scores
 * and the 10 most recent community reviews.
 */
router.get("/:id/hours", async (req, res) => {
    try {
        const location = await prisma.location.findUnique({
            where: { id: req.params.id },
            select: { googlePlaceId: true },
        });
        if (!location?.googlePlaceId) return res.json({ available: false });

        const key = process.env.GOOGLE_PLACES_KEY;
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${location.googlePlaceId}&fields=opening_hours,utc_offset_minutes&key=${key}`;
        const response = await fetch(url);
        const data = await response.json();

        const hours = data.result?.opening_hours;
        if (!hours) return res.json({ available: false });

        res.json({
            available: true,
            open_now: hours.open_now ?? null,
            weekday_text: hours.weekday_text ?? [],
        });
    } catch {
        res.json({ available: false });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const location = await prisma.location.findUnique({
            where: { id: req.params.id },
            include: {
                sensoryScores: true,
                reviews: {
                    orderBy: { createdAt: "desc" },
                    take: 10,
                    include: {
                        user: { select: { username: true, email: true } }
                    }
                }
            }
        });

        if (!location) return res.status(404).json({ error: "Location not found" });

        const displayScores = getDisplayScore({
            reviewCount:            location.sensoryScores?.reviewCount    ?? 0,
            noiseScore:             location.sensoryScores?.noiseScore     ?? null,
            lightingScore:          location.sensoryScores?.lightingScore  ?? null,
            crowdScore:             location.sensoryScores?.crowdScore     ?? null,
            comfortScore:           location.sensoryScores?.comfortScore   ?? null,
            estimatedNoiseScore:    location.estimatedNoiseScore,
            estimatedLightingScore: location.estimatedLightingScore,
            estimatedCrowdScore:    location.estimatedCrowdScore,
        });

        res.json({ ...location, displayScores });
    } catch (error) {
        console.error("Error fetching location:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;