import axios from "axios";

const YELP_API_BASE = "https://api.yelp.com/v3";
const FOURSQUARE_API_BASE = "https://api.foursquare.com/v3";
const TORONTO_CKAN_BASE = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action";
const TORONTO_PARKS_RESOURCE = "e8cd0f4d-4910-42a0-81f9-cf8c2218753a";
const TORONTO_LIBRARY_RESOURCE = "1c9e7b16-c8fc-4925-9639-1253b6e02422";

function yelpBusinessToText(business) {
    const categories = (business.categories ?? []).map((c) => c.title).join(", ");
    const price = business.price ?? "";
    const rating = business.rating ?? "";
    const reviewCount = business.review_count ?? 0;
    const parts = [];
    if (categories) parts.push(`${business.name} is a ${categories} establishment.`);
    if (price) parts.push(`Price level: ${price}.`);
    if (rating) parts.push(`Yelp rating: ${rating}/5 stars based on ${reviewCount} reviews.`);
    return parts.join(" ");
}

async function fetchYelp(name, lat, lng) {
    if (!process.env.YELP_API_KEY) return { text: "", yelpId: null };

    let business = null;
    try {
        const searchRes = await axios.get(`${YELP_API_BASE}/businesses/search`, {
            headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
            params: { term: name, latitude: lat, longitude: lng, limit: 1 },
            timeout: 8000,
        });
        business = searchRes.data.businesses?.[0] ?? null;
    } catch {
        return { text: "", yelpId: null };
    }

    if (!business) return { text: "", yelpId: null };

    // Try reviews endpoint — may be blocked on Base plan, fall back to business metadata
    try {
        const reviewsRes = await axios.get(`${YELP_API_BASE}/businesses/${business.id}/reviews`, {
            headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
            params: { limit: 10, sort_by: "newest" },
            timeout: 6000,
        });
        const reviews = reviewsRes.data.reviews ?? [];
        const reviewText = reviews.map((r) => r.text).filter(Boolean).join("\n");
        if (reviewText) return { text: reviewText, yelpId: business.id };
    } catch {
        // Reviews endpoint blocked — use business metadata instead
    }

    return { text: yelpBusinessToText(business), yelpId: business.id };
}

async function fetchFoursquare(name, lat, lng) {
    try {
        if (!process.env.FOURSQUARE_API_KEY) return "";

        const searchRes = await axios.get(`${FOURSQUARE_API_BASE}/places/search`, {
            headers: { Authorization: process.env.FOURSQUARE_API_KEY },
            params: { query: name, ll: `${lat},${lng}`, limit: 1 },
            timeout: 8000,
        });
        const place = searchRes.data.results?.[0];
        if (!place) return "";

        const tipsRes = await axios.get(`${FOURSQUARE_API_BASE}/places/${place.fsq_id}/tips`, {
            headers: { Authorization: process.env.FOURSQUARE_API_KEY },
            params: { limit: 5 },
            timeout: 8000,
        });
        const tips = tipsRes.data ?? [];
        return tips.map((t) => t.text).filter(Boolean).join("\n");
    } catch {
        return "";
    }
}

async function fetchReddit(name) {
    try {
        const query = encodeURIComponent(`${name} toronto noise OR crowd OR lighting`);
        const res = await axios.get(
            `https://www.reddit.com/search.json?q=${query}&limit=5&sort=relevance`,
            {
                headers: { "User-Agent": "SenseMap/1.0 (sensory-mapping-app)" },
                timeout: 8000,
            }
        );
        const posts = res.data?.data?.children ?? [];
        const nameLower = name.toLowerCase();
        return posts
            .filter((p) => {
                const title = (p.data.title ?? "").toLowerCase();
                const body = (p.data.selftext ?? "").toLowerCase();
                return title.includes(nameLower) || body.includes(nameLower);
            })
            .map((p) => `${p.data.title}. ${p.data.selftext}`.trim())
            .join("\n");
    } catch {
        return "";
    }
}

// Returns distance in metres between two lat/lng points
function haversineMetres(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function fetchGooglePlaces(name, lat, lng) {
    try {
        if (!process.env.GOOGLE_PLACES_KEY) return "";

        const searchRes = await axios.get("https://maps.googleapis.com/maps/api/place/textsearch/json", {
            params: { query: `${name} Toronto`, location: `${lat},${lng}`, radius: 500, key: process.env.GOOGLE_PLACES_KEY },
            timeout: 8000,
        });

        const result = searchRes.data.results?.[0];
        if (!result?.place_id) return "";

        // Google Text Search uses location+radius as a bias not a hard filter — validate proximity
        const placeLat = result.geometry?.location?.lat;
        const placeLng = result.geometry?.location?.lng;
        if (placeLat != null && placeLng != null) {
            const distanceM = haversineMetres(lat, lng, placeLat, placeLng);
            if (distanceM > 1000) return ""; // >1km away — likely a name collision, skip
        }

        const placeId = result.place_id;

        const detailsRes = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
            params: { place_id: placeId, fields: "reviews,rating,user_ratings_total", key: process.env.GOOGLE_PLACES_KEY },
            timeout: 8000,
        });

        const reviews = detailsRes.data.result?.reviews ?? [];
        return reviews.map((r) => r.text).filter(Boolean).join("\n");
    } catch {
        return "";
    }
}

async function fetchCityOfToronto(name, category) {
    try {
        const cat = (category ?? "").toLowerCase();
        const isLibrary = /library/.test(cat);
        const isPark = /park|garden|green/.test(cat);
        if (!isLibrary && !isPark) return "";

        const resourceId = isLibrary ? TORONTO_LIBRARY_RESOURCE : TORONTO_PARKS_RESOURCE;
        const res = await axios.get(`${TORONTO_CKAN_BASE}/datastore_search`, {
            params: { resource_id: resourceId, q: name, limit: 1 },
            timeout: 8000,
        });

        const record = res.data.result?.records?.[0];
        if (!record) return "";

        if (isLibrary) {
            const parts = [];
            if (record.BRANCHNAME) parts.push(`${record.BRANCHNAME} is a Toronto Public Library branch.`);
            if (record.SQUARE_FOOTAGE) parts.push(`Size: ${record.SQUARE_FOOTAGE} sq ft.`);
            if (record.MEETING_ROOMS) parts.push(`Meeting rooms: ${record.MEETING_ROOMS}.`);
            return parts.join(" ");
        }

        // Park record
        const parts = [];
        const facilityName = record.ASSET_DESCRIPTION || record.ASSET_NAME || name;
        parts.push(`${facilityName} is a City of Toronto park or recreation facility.`);
        if (record.ASSET_TYPE) parts.push(`Type: ${record.ASSET_TYPE}.`);
        if (record.LOCATION_NAME) parts.push(`Located at ${record.LOCATION_NAME}.`);
        return parts.join(" ");
    } catch {
        return "";
    }
}

export async function fetchAllSources({ name, latitude, longitude, category = null, existingYelpId = null }) {
    const [yelpResult, foursquareText, redditText, googleText, torontoText] = await Promise.all([
        existingYelpId
            ? fetchYelpById(existingYelpId).then((text) => ({ text, yelpId: existingYelpId }))
            : fetchYelp(name, latitude, longitude),
        fetchFoursquare(name, latitude, longitude),
        fetchReddit(name),
        fetchGooglePlaces(name, latitude, longitude),
        fetchCityOfToronto(name, category),
    ]);

    const parts = [];
    const sources = [];

    if (yelpResult.text) {
        parts.push(yelpResult.text);
        sources.push("yelp");
    }
    if (foursquareText) {
        parts.push(foursquareText);
        sources.push("foursquare");
    }
    if (redditText) {
        parts.push(redditText);
        sources.push("reddit");
    }
    if (googleText) {
        parts.push(googleText);
        sources.push("google");
    }
    if (torontoText) {
        parts.push(torontoText);
        sources.push("toronto");
    }

    const combinedText = parts.join("\n\n");
    return {
        combinedText,
        sources,
        characterCount: combinedText.length,
        yelpId: yelpResult.yelpId,
    };
}

async function fetchYelpById(yelpId) {
    try {
        const reviewsRes = await axios.get(`${YELP_API_BASE}/businesses/${yelpId}/reviews`, {
            headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
            params: { limit: 10, sort_by: "newest" },
            timeout: 6000,
        });
        const reviews = reviewsRes.data.reviews ?? [];
        const reviewText = reviews.map((r) => r.text).filter(Boolean).join("\n");
        if (reviewText) return reviewText;
    } catch {
        // Reviews endpoint blocked — fall back to business details
    }

    try {
        const detailsRes = await axios.get(`${YELP_API_BASE}/businesses/${yelpId}`, {
            headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
            timeout: 8000,
        });
        return yelpBusinessToText(detailsRes.data);
    } catch {
        return "";
    }
}
