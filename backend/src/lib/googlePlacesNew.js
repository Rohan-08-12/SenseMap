/**
 * Google Places API (New): Text Search.   POST https://places.googleapis.com/v1/places:searchText
 *
 * Auth is the X-Goog-Api-Key header (the key never appears in a URL, so it cannot leak through logs of a URL).
 * X-Goog-FieldMask is REQUIRED by this API and decides the billing SKU, so callers pass the smallest mask they need.
 * Returns { status, errorMessage, places } and never throws on a Google-side denial:
 *   status "OK" | "ZERO_RESULTS" | Google's own error status (e.g. "PERMISSION_DENIED") | "HTTP_<code>" | "NETWORK_ERROR"
 *   places are mapped to the legacy field names the rest of the app uses ({ place_id, name, formatted_address,
 *   geometry: { location: { lat, lng } } }) so callers can switch over without reshaping.
 */
export const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
export const MIN_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";

/** Strips anything key-shaped (and the exact key, if given) from text bound for a log or a report. */
export function redactSecrets(text, key) {
    let s = String(text ?? "");
    if (key) s = s.split(key).join("[redacted]");
    return s.replace(/key=[^&\s"]+/gi, "key=[redacted]").replace(/AIza[\w-]{10,}/g, "[redacted]");
}

/** New API place -> the legacy-shaped fields this codebase already uses. */
export function mapNewPlace(p) {
    return {
        place_id: p.id,
        name: p.displayName?.text ?? "",
        formatted_address: p.formattedAddress ?? null,
        geometry: p.location ? { location: { lat: p.location.latitude, lng: p.location.longitude } } : undefined,
    };
}

export async function searchTextNew(query, { lat, lng, radius = 2000, key = process.env.GOOGLE_PLACES_KEY, fieldMask = MIN_FIELD_MASK, fetchImpl = fetch } = {}) {
    const body = { textQuery: query };
    if (lat != null && lng != null) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radius, 50000) } };
    try {
        const res = await fetchImpl(SEARCH_TEXT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
            body: JSON.stringify(body),
        });
        let data = {};
        try { data = await res.json(); } catch { /* non-JSON error body */ }
        if (!res.ok) {
            return { status: data?.error?.status || `HTTP_${res.status}`, errorMessage: redactSecrets(data?.error?.message, key), places: [] };
        }
        const places = (data.places || []).map(mapNewPlace);
        return { status: places.length ? "OK" : "ZERO_RESULTS", errorMessage: undefined, places };
    } catch (err) {
        return { status: "NETWORK_ERROR", errorMessage: redactSecrets(err.message, key), places: [] };
    }
}
