/**
 * Google Places TEXT SEARCH (legacy "Places API", maps.googleapis.com/maps/api/place/textsearch/json).
 * The one place that builds this request, so the app (placesService.searchGooglePlaces) and
 * scripts/add_extra_places.js call Google identically: same endpoint, key as the `key` query
 * parameter, key read from GOOGLE_PLACES_KEY. No field mask is used (that exists only on Details).
 *
 * Returns { status, errorMessage, results }. It never throws on a Google-side denial, and the key is
 * never included in anything returned. `location` + `radius` are only added when lat/lng are given.
 */
export const TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json";

export function buildTextSearchUrl({ query, lat, lng, radius = 30000, key = process.env.GOOGLE_PLACES_KEY }) {
    let url = `${TEXT_SEARCH_URL}?query=${encodeURIComponent(query)}`;
    if (lat != null && lng != null) url += `&location=${lat},${lng}&radius=${radius}`;
    return `${url}&key=${key}`;
}

export async function textSearchPlaces(query, { lat, lng, radius, key = process.env.GOOGLE_PLACES_KEY, fetchImpl = fetch } = {}) {
    const res = await fetchImpl(buildTextSearchUrl({ query, lat, lng, radius, key }));
    const data = await res.json();
    return { status: data.status, errorMessage: data.error_message, results: data.results || [] };
}
