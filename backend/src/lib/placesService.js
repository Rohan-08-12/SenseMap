import prisma from "./prisma.js";
import cloudinary from "./cloudinary.js";

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

// Bounding box for Greater Toronto Area
const TORONTO_BOUNDS = { latMin: 43.4, latMax: 43.9, lngMin: -79.75, lngMax: -79.0 };

function inToronto(lat, lng) {
    return lat >= TORONTO_BOUNDS.latMin && lat <= TORONTO_BOUNDS.latMax &&
           lng >= TORONTO_BOUNDS.lngMin && lng <= TORONTO_BOUNDS.lngMax;
}

export async function searchGooglePlaces(query, lat, lng) {
    const key = process.env.GOOGLE_PLACES_KEY;
    const searchLat = lat ?? TORONTO_LAT;
    const searchLng = lng ?? TORONTO_LNG;
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&location=${searchLat},${searchLng}&radius=30000&key=${key}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.results || []).filter(p =>
        inToronto(p.geometry?.location?.lat, p.geometry?.location?.lng)
    );
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

    let imageUrl = null;
    const photoRef = details.photos?.[0]?.photo_reference;
    if (photoRef) {
        imageUrl = await uploadPlacePhoto(photoRef);
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

    return prisma.location.findUnique({
        where: { id: location.id },
        include: { sensoryScores: true },
    });
}
