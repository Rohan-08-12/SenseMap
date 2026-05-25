import express from "express";
import prisma from "../lib/prisma.js";
import { toGeoJSON } from "../lib/geojson.js";
import { getSystemUser } from "../lib/systemBot.js";
import {
    searchGooglePlaces,
    getGooglePlaceDetails,
    uploadPlacePhoto,
    classifyCategory,
    analyzeWithGemini,
    discoverAndCachePlace,
} from "../lib/placesService.js";

const router = express.Router();

async function quickCachePlace(googlePlace) {
    const gpid = googlePlace.place_id;

    const existing = await prisma.location.findUnique({
        where: { googlePlaceId: gpid },
        include: { sensoryScores: true },
    });
    if (existing) return existing;

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
    const googleReviews = (details.reviews || []).slice(0, 5);

    if (photoRef || googleReviews.length > 0) {
        enrichLocationInBackground(location.id, photoRef, details.name, category, googleReviews);
    }

    return { ...location, sensoryScores: null };
}

function enrichLocationInBackground(locationId, photoRef, name, category, googleReviews) {
    (async () => {
        try {
            if (photoRef) {
                const imageUrl = await uploadPlacePhoto(photoRef);
                if (imageUrl) {
                    await prisma.location.update({ where: { id: locationId }, data: { imageUrl } });
                }
            }

            if (googleReviews.length > 0) {
                const analysis = await analyzeWithGemini(name, category, googleReviews);

                const existingScore = await prisma.sensoryScore.findUnique({ where: { locationId } });
                if (!existingScore) {
                    await prisma.sensoryScore.create({
                        data: {
                            locationId,
                            noiseScore: analysis.noiseScore,
                            lightingScore: analysis.lightingScore,
                            crowdScore: analysis.crowdScore,
                            comfortScore: analysis.comfortScore,
                            reviewCount: analysis.reviews.length,
                        },
                    });

                    const systemUser = await getSystemUser();

                    for (const review of analysis.reviews) {
                        await prisma.review.create({
                            data: {
                                userId: systemUser.id,
                                locationId,
                                bodyText: review.bodyText,
                                rating: review.rating,
                                noiseLevel: review.noiseLevel,
                                lightingLevel: review.lightingLevel,
                                crowdLevel: review.crowdLevel,
                            },
                        });
                    }
                }
            }
            console.log(`[discover] Background enrichment done for: ${name}`);
        } catch (err) {
            console.error(`[discover] Background enrichment failed for ${name}: ${err.message}`);
        }
    })();
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
