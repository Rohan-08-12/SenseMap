import axios from "axios";
import { haversineMetres } from "../lib/geo.js";

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

    // Use business metadata only — Yelp ToS prohibits using review text to generate AI-derived content
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

async function fetchGooglePlaces(name, lat, lng) {
    try {
        if (!process.env.GOOGLE_PLACES_KEY) return "";

        const searchRes = await axios.get("https://maps.googleapis.com/maps/api/place/textsearch/json", {
            params: { query: `${name} Toronto`, location: `${lat},${lng}`, radius: 500, key: process.env.GOOGLE_PLACES_KEY },
            timeout: 8000,
        });

        const result = searchRes.data.results?.[0];
        if (!result?.place_id) return "";

        const placeLat = result.geometry?.location?.lat;
        const placeLng = result.geometry?.location?.lng;
        if (placeLat != null && placeLng != null) {
            const distanceM = haversineMetres(lat, lng, placeLat, placeLng);
            if (distanceM > 1000) return "";
        }

        const placeId = result.place_id;

        // Fetch rating and editorial summary only — Google ToS prohibits feeding
        // user-generated review text into AI models to generate derived content
        const detailsRes = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
            params: { place_id: placeId, fields: "rating,user_ratings_total,editorial_summary", key: process.env.GOOGLE_PLACES_KEY },
            timeout: 8000,
        });

        const detail = detailsRes.data.result ?? {};
        const parts = [];
        if (detail.rating) parts.push(`Google rating: ${detail.rating}/5 based on ${detail.user_ratings_total ?? 0} reviews.`);
        if (detail.editorial_summary?.overview) parts.push(detail.editorial_summary.overview);
        return parts.join(" ");
    } catch {
        return "";
    }
}

async function fetchCityOfToronto(name, category, lat, lng) {
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
            // Validate by name fuzzy-match — no coordinates available in this dataset
            const recordName = (record.BRANCHNAME ?? "").toLowerCase();
            const queryWords = name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const nameMatch = queryWords.some(w => recordName.includes(w));
            if (!nameMatch) return "";

            const parts = [];
            if (record.BRANCHNAME) parts.push(`${record.BRANCHNAME} is a Toronto Public Library branch.`);
            if (record.SQUARE_FOOTAGE) parts.push(`Size: ${record.SQUARE_FOOTAGE} sq ft.`);
            if (record.MEETING_ROOMS) parts.push(`Meeting rooms: ${record.MEETING_ROOMS}.`);
            return parts.join(" ");
        }

        // Park record — validate by coordinate proximity using geometry field
        if (record.geometry) {
            try {
                const geo = JSON.parse(record.geometry);
                const [geoLng, geoLat] = geo.coordinates;
                if (haversineMetres(lat, lng, geoLat, geoLng) > 1000) return "";
            } catch {
                // Geometry unparseable — fall back to name match
                const recordName = (record.ASSET_NAME ?? "").toLowerCase();
                const queryWords = name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                if (!queryWords.some(w => recordName.includes(w))) return "";
            }
        }

        const parts = [];
        const facilityName = record.ASSET_NAME || name;
        parts.push(`${facilityName} is a City of Toronto park or recreation facility.`);
        if (record.TYPE) parts.push(`Type: ${record.TYPE}.`);
        if (record.AMENITIES) parts.push(`Amenities: ${record.AMENITIES}.`);
        if (record.ADDRESS) parts.push(`Address: ${record.ADDRESS}.`);
        return parts.join(" ");
    } catch {
        return "";
    }
}

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

// Fetches raw OSM tags for a location imported via osm-import.js — its googlePlaceId is stored
// as "osm_{type}_{id}" (see osm-import.js). Free public API, no key required. Returns null for
// non-OSM locations (Google-Places-sourced) or if the element/tags can't be found.
async function fetchOsmTags(googlePlaceId) {
    if (!googlePlaceId || !googlePlaceId.startsWith("osm_")) return null;

    const [, osmType, osmId] = googlePlaceId.split("_");
    if (!["node", "way", "relation"].includes(osmType) || !osmId) return null;

    try {
        const query = `[out:json][timeout:8];${osmType}(${osmId});out tags;`;
        const res = await axios.post(OVERPASS_API, query, {
            // Overpass's Apache front-end 406s axios's default User-Agent (mod_security-style
            // UA filtering) — a real, non-obvious quirk of their server, not our request format.
            headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "SenseMap/1.0 (+https://sensemap.app)" },
            timeout: 8000,
        });
        return res.data?.elements?.[0]?.tags ?? null;
    } catch {
        return null;
    }
}

// Maps a handful of well-defined, unambiguous OSM tags directly onto the facilities pill
// options — deterministic (no LLM inference) and only emits a tag when the OSM data is
// explicit about it. Conservative on purpose: better to omit than to guess from a fuzzy tag.
function mapOsmTagsToFacilities(tags) {
    if (!tags) return null;
    const facilities = {};

    const bathrooms = [];
    if (tags.toilets === "yes") bathrooms.push("Public bathroom available");
    if (tags.toilets === "no") bathrooms.push("No public bathroom");
    if (tags["toilets:wheelchair"] === "yes") bathrooms.push("Accessible bathroom");
    if (tags["toilets:unisex"] === "yes") bathrooms.push("Unisex");
    if (tags["toilets:unisex"] === "no") bathrooms.push("Gendered");
    if (bathrooms.length > 0) facilities.bathrooms = bathrooms;

    const seating = [];
    if (tags.outdoor_seating === "yes" || tags.indoor_seating === "yes") seating.push("Plenty of seating");
    if (tags.outdoor_seating === "no" && tags.indoor_seating === "no") seating.push("No seating");
    if (seating.length > 0) facilities.seating = seating;

    const temperature = [];
    if (tags.air_conditioning === "yes") temperature.push("Good airflow");
    if (temperature.length > 0) facilities.temperature = temperature;

    const socialInteractions = [];
    if (tags.self_service === "yes") socialInteractions.push("Self-checkout available");
    if (socialInteractions.length > 0) facilities.socialInteractions = socialInteractions;

    return Object.keys(facilities).length > 0 ? facilities : null;
}

export async function fetchAllSources({ name, latitude, longitude, category = null, existingYelpId = null, googlePlaceId = null }) {
    const [yelpResult, foursquareText, googleText, torontoText, osmTags] = await Promise.all([
        existingYelpId
            ? fetchYelpById(existingYelpId).then((text) => ({ text, yelpId: existingYelpId }))
            : fetchYelp(name, latitude, longitude),
        fetchFoursquare(name, latitude, longitude),
        fetchGooglePlaces(name, latitude, longitude),
        fetchCityOfToronto(name, category, latitude, longitude),
        fetchOsmTags(googlePlaceId),
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
    if (googleText) {
        parts.push(googleText);
        sources.push("google");
    }
    if (torontoText) {
        parts.push(torontoText);
        sources.push("toronto");
    }

    const osmFacilities = mapOsmTagsToFacilities(osmTags);
    if (osmFacilities) sources.push("osm");

    const combinedText = parts.join("\n\n");
    return {
        combinedText,
        sources,
        characterCount: combinedText.length,
        yelpId: yelpResult.yelpId,
        osmFacilities,
    };
}

async function fetchYelpById(yelpId) {
    // Use business metadata only — Yelp ToS prohibits using review text for AI-derived content
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
