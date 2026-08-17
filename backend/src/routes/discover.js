import express from "express";
import prisma from "../lib/prisma.js";
import { toGeoJSON } from "../lib/geojson.js";
import { haversineMetres } from "../lib/geo.js";
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

const DEDUP_RADIUS_METRES = 150;

function normalizeName(name) {
    return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function namesLikelyMatch(a, b) {
    const na = normalizeName(a), nb = normalizeName(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
}

// Finds an existing Location for the same physical place even when it wasn't cached via this
// endpoint originally — e.g. seeded by osm-import.js, whose synthetic "osm_{type}_{id}"
// googlePlaceId never matches a real Google Place ID, so the exact-id lookup above always
// misses it. Without this, searching by name for an OSM-imported place (which already has
// real community reviews / enrichment data) would silently create a zero-data duplicate row.
async function findDuplicateByProximity(name, lat, lng) {
    const delta = 0.002; // ~150-220m bounding box in Toronto's latitude, refined below by exact distance
    const candidates = await prisma.location.findMany({
        where: {
            latitude: { gte: lat - delta, lte: lat + delta },
            longitude: { gte: lng - delta, lte: lng + delta },
        },
        include: { sensoryScores: true },
    });
    return candidates.find((c) =>
        haversineMetres(lat, lng, c.latitude, c.longitude) <= DEDUP_RADIUS_METRES &&
        namesLikelyMatch(name, c.name)
    ) ?? null;
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

    // Reuse a same-place record seeded under a different id scheme instead of duplicating it —
    // and backfill its real Google Place ID so it (a) gets one for future photo/detail lookups
    // and (b) is found directly by the exact-id check above next time, self-healing this path.
    const duplicate = await findDuplicateByProximity(googlePlace.name, lat, lng);
    if (duplicate) {
        if (duplicate.googlePlaceId === gpid) return duplicate;
        return prisma.location.update({
            where: { id: duplicate.id },
            data: { googlePlaceId: gpid },
            include: { sensoryScores: true },
        });
    }

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
