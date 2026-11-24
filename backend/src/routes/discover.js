import express from "express";
import prisma from "../lib/prisma.js";
import { toGeoJSON } from "../lib/geojson.js";
import { createTtlPromiseCache } from "../lib/ttlPromiseCache.js";
import { resolveGoogleResults } from "../lib/discoverResolve.js";
import {
    searchGooglePlaces,
    getGooglePlaceDetails,
    uploadPlacePhoto,
    classifyCategory,
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

// Existing-place matching (Google id, then exact normalised name within 100 m) and the per-search cap on newly stored
// places live in lib/findExistingPlace.js and lib/discoverResolve.js.

const searchCache = createTtlPromiseCache({ ttlMs: 60 * 60 * 1000, max: 500 });

// Same search (text + position rounded to ~1 km) within an hour reuses the first search's Google work. Only the
// stored location ids are cached; the rows are re-read each time so scores stay fresh.
export function searchCacheKey(q, lat, lng) {
    const r = (n) => (Number.isFinite(n) ? n.toFixed(2) : "-");
    return `${String(q).trim().toLowerCase().replace(/\s+/g, " ")}|${r(lat)}|${r(lng)}`;
}

function resolveSearch(q, lat, lng) {
    const key = searchCacheKey(q, lat, lng);
    const hit = searchCache.get(key);
    if (hit) return hit;
    const work = (async () => {
        const results = await searchGooglePlaces(q, lat, lng);
        const locations = await resolveGoogleResults(results, {
            prisma,
            getDetails: getGooglePlaceDetails,
            classifyCategory,
            inBounds: isInToronto,
            onCreated: (location, details) => {
                const photoRef = details.photos?.[0]?.photo_reference;
                if (photoRef) queueEnrichment(() => enrichLocationInBackground(location.id, photoRef, details.name));
            },
        });
        return locations.map((l) => l.id);
    })();
    return searchCache.set(key, work);
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
        const ids = await resolveSearch(q, parsedLat, parsedLng);
        return ids.length ? prisma.location.findMany({ where: { id: { in: ids } }, include: { sensoryScores: true } }) : [];
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
