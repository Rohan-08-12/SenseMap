import prisma from "./prisma.js";
import cloudinary from "./cloudinary.js";
import { model } from "./gemini.js";
import { getSystemUser } from "./systemBot.js";

const CATEGORY_MAP = {
    library: "library",
    book_store: "bookstore",
    park: "park",
    cafe: "cafe",
    restaurant: "restaurant",
    museum: "museum",
    shopping_mall: "retail",
    store: "retail",
    tourist_attraction: "attraction",
    art_gallery: "museum",
    church: "worship",
    gym: "fitness",
    spa: "wellness",
    movie_theater: "entertainment",
    bar: "bar",
    night_club: "nightlife",
    school: "education",
    university: "education",
};

export function classifyCategory(types) {
    for (const type of types || []) {
        if (CATEGORY_MAP[type]) return CATEGORY_MAP[type];
    }
    return "other";
}

const TORONTO_LAT = 43.6532;
const TORONTO_LNG = -79.3832;

export async function searchGooglePlaces(query, lat, lng) {
    const key = process.env.GOOGLE_PLACES_KEY;
    const searchLat = lat ?? TORONTO_LAT;
    const searchLng = lng ?? TORONTO_LNG;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${searchLat},${searchLng}&radius=30000&strictbounds&key=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results || [];
}

export async function getGooglePlaceDetails(placeId) {
    const key = process.env.GOOGLE_PLACES_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,types,reviews,rating,editorial_summary,photos,place_id&key=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.result || null;
}

export async function uploadPlacePhoto(photoReference) {
    try {
        const key = process.env.GOOGLE_PLACES_KEY;
        const googlePhotoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReference}&key=${key}`;
        const result = await cloudinary.uploader.upload(googlePhotoUrl, {
            folder: "sensorysafe/places",
        });
        return result.secure_url;
    } catch (err) {
        console.error(`Photo upload failed: ${err.message}`);
        return null;
    }
}

export async function analyzeWithGemini(name, category, reviews) {
    const reviewTexts = reviews
        .map((r, i) => `Review ${i + 1} (${r.rating}/5 stars): ${r.text}`)
        .join("\n\n");

    const prompt = `You are a sensory environment analyst helping people with autism and sensory sensitivities evaluate public spaces.

Given these Google reviews for "${name}" (${category}):

${reviewTexts}

Analyze the sensory environment and return ONLY a valid JSON object with this exact structure (no markdown, no backticks, no explanation):
{
  "noiseScore": <number 1.0-5.0, where 1=very quiet, 5=very loud>,
  "lightingScore": <number 1.0-5.0, where 1=very dim/soft, 5=very bright/harsh>,
  "crowdScore": <number 1.0-5.0, where 1=empty/sparse, 5=very crowded>,
  "comfortScore": <number 1.0-5.0, overall sensory comfort for sensitive individuals, 5=most comfortable>,
  "reviews": [
    {
      "bodyText": "<a realistic sensory-focused review from perspective of a sensory-sensitive visitor, 2-3 sentences>",
      "rating": <number 1-10, overall comfort rating>,
      "noiseLevel": <number 1-10>,
      "lightingLevel": <number 1-10>,
      "crowdLevel": <number 1-10>
    },
    {
      "bodyText": "<second unique sensory-focused review>",
      "rating": <number 1-10>,
      "noiseLevel": <number 1-10>,
      "lightingLevel": <number 1-10>,
      "crowdLevel": <number 1-10>
    },
    {
      "bodyText": "<third unique sensory-focused review>",
      "rating": <number 1-10>,
      "noiseLevel": <number 1-10>,
      "lightingLevel": <number 1-10>,
      "crowdLevel": <number 1-10>
    }
  ]
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
}


export async function discoverAndCachePlace(googlePlace) {
    const gpid = googlePlace.place_id;

    const existing = await prisma.location.findUnique({
        where: { googlePlaceId: gpid },
        include: { sensoryScores: true },
    });
    if (existing) return existing;

    const details = await getGooglePlaceDetails(gpid);
    if (!details) return null;

    const category = classifyCategory(details.types);
    const googleReviews = details.reviews || [];

    let imageUrl = null;
    const photoRef = details.photos?.[0]?.photo_reference;
    if (photoRef) {
        imageUrl = await uploadPlacePhoto(photoRef);
    }

    let analysis = null;
    if (googleReviews.length > 0) {
        try {
            analysis = await analyzeWithGemini(details.name, category, googleReviews.slice(0, 5));
        } catch (err) {
            console.error(`Gemini analysis failed for ${details.name}: ${err.message}`);
        }
    }

    const location = await prisma.location.create({
        data: {
            googlePlaceId: gpid,
            name: details.name,
            description: details.editorial_summary?.overview || null,
            category,
            address: details.formatted_address,
            imageUrl,
            latitude: details.geometry.location.lat,
            longitude: details.geometry.location.lng,
        },
    });

    if (analysis) {
        await prisma.sensoryScore.create({
            data: {
                locationId: location.id,
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
                    locationId: location.id,
                    bodyText: review.bodyText,
                    rating: review.rating,
                    noiseLevel: review.noiseLevel,
                    lightingLevel: review.lightingLevel,
                    crowdLevel: review.crowdLevel,
                },
            });
        }
    }

    return prisma.location.findUnique({
        where: { id: location.id },
        include: { sensoryScores: true },
    });
}
