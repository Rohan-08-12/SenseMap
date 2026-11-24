import { redactSecrets } from "./googlePlacesNew.js";

// Statuses that mean "Google answered fine" (ZERO_RESULTS just means no match). Same set the enrichment scraper uses.
export const GOOGLE_OK_STATUSES = new Set(["OK", "ZERO_RESULTS"]);

/**
 * Logs one greppable line when a legacy Places response says something other than OK / ZERO_RESULTS
 * (REQUEST_DENIED, OVER_QUERY_LIMIT, ...), with Google's error_message and the key redacted. Never throws and
 * never changes what the caller returns: it exists so a denied call is visible instead of silently looking like "no results".
 */
export function logGoogleDenial(endpoint, data, subject = "") {
    const status = data?.status;
    if (!status || GOOGLE_OK_STATUSES.has(status)) return null;
    const detail = redactSecrets(data.error_message ?? "").slice(0, 200);
    console.warn(`[Google Places] ${endpoint} issue=${status}${subject ? ` for="${String(subject).slice(0, 80)}"` : ""}${detail ? ` detail="${detail}"` : ""}`);
    return status;
}
