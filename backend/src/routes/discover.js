import express from "express";
import prisma from "../lib/prisma.js";
import { toGeoJSON } from "../lib/geojson.js";
import {
    searchGooglePlaces,
    getGooglePlaceDetails,
    uploadPlacePhoto,
    classifyCategory,
    discoverAndCachePlace,
} from "../lib/placesService.js";

const router = express.Router();

// Serialize Gemini enrichment calls to avoid blowing the free-tier quota (20 req/day)
// when a search returns multiple new locations simultaneously.
let enrichmentQueue = Promise.resolve();
function queueEnrichment(fn) {
    enrichmentQueue = enrichmentQueue.then(() => fn().catch(() => {}));
}

const TORONTO_BOUNDS = { minLat: 43.58, maxLat: 43.86, minLng: -79.64, maxLng: -79.11 };

function isInToronto(lat, lng) {
    return lat >= TORONTO_BOUNDS.minLat && lat <= TORONTO_BOUNDS.maxLat &&
           lng >= TORONTO_BOUNDS.minLng && lng <= TORONTO_BOUNDS.maxLng;
}

async function quickCachePlace(googlePlace) {
    const gpid = googlePlace.place_id;

    const existing = await prisma.location.findUnique({
        where: { googlePlaceId: gpid },
        include: { sensoryScores: true },
    });
    if (existing) return existing;

    const lat = googlePlace.geometry?.location?.lat;
    const lng = googlePlace.geometry?.location?.lng;
    if (!isInToronto(lat, lng)) return null;

    const details = await getGooglePlaceDetails(gpid);
    if (!details) return null;

    const category = classifyCategory(details.types);

    const location = await prisma.location.create({
        data: {
            googlePlaceId: gpid,
            name: details.name,
            description: details.editorial_summary?.overview || null,
            category,
            address: details.formatted_address,
            latitude: details.geometry.location.lat,
            longitude: details.geometry.location.lng,
        },
    });

    const photoRef = details.photos?.[0]?.photo_reference;
    if (photoRef) {
        queueEnrichment(() => enrichLocationInBackground(location.id, photoRef, details.name));
    }

    return { ...location, sensoryScores: null };
}

async function enrichLocationInBackground(locationId, photoRef, name) {
    try {
        const imageUrl = await uploadPlacePhoto(photoRef);
        if (imageUrl) {
            await prisma.location.update({ where: { id: locationId }, data: { imageUrl } });
        }
        console.log(`[discover] Photo saved for: ${name}`);
    } catch (err) {
        console.error(`[discover] Photo enrichment failed for ${name}: ${err.message}`);
    }
}

// GET /discover?q=cafes&lat=43.46&lng=-80.52
router.get("/", async (req, res) => {
    const { q, lat, lng } = req.query;
    if (!q) return res.status(400).json({ error: "Query parameter q is required" });
    if (q.length > 200) return res.status(400).json({ error: "Query too long" });

    const parsedLat = lat != null ? parseFloat(lat) : undefined;
    const parsedLng = lng != null ? parseFloat(lng) : undefined;

    let dbLocations = [];
    let googleLocations = [];
    let partial = false;

    const dbPromise = prisma.location.findMany({
        where: {
            OR: [
                { name: { contains: q, mode: "insensitive" } },
                { category: { contains: q, mode: "insensitive" } },
                { address: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
            ],
        },
        include: { sensoryScores: true },
    });

    const GOOGLE_TIMEOUT_MS = 12000;
    const googlePromise = (async () => {
        const results = await searchGooglePlaces(q, parsedLat, parsedLng);
        const top5 = results.slice(0, 10);

        const settled = await Promise.allSettled(
            top5.map((place) => quickCachePlace(place))
        );

        return settled
            .filter((r) => r.status === "fulfilled" && r.value != null)
            .map((r) => r.value);
    })();

    const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve("TIMEOUT"), GOOGLE_TIMEOUT_MS)
    );

    try {
        dbLocations = await dbPromise;

        const googleResult = await Promise.race([googlePromise, timeoutPromise]);

        if (googleResult === "TIMEOUT") {
            partial = true;
        } else {
            googleLocations = googleResult;
        }
    } catch (err) {
        console.error("Discover error:", err.message);
        partial = true;
    }

    const locationMap = new Map();
    for (const loc of dbLocations) {
        locationMap.set(loc.id, loc);
    }
    for (const loc of googleLocations) {
        if (!locationMap.has(loc.id)) {
            locationMap.set(loc.id, loc);
        }
    }

    const combined = Array.from(locationMap.values());
    const geoJSON = toGeoJSON(combined);

    if (partial) {
        geoJSON.partial = true;
    }

    res.json(geoJSON);
});

export default router;
