/**
 * The one "does this place already exist?" check, used by GET /discover and scripts/add_extra_places.js.
 *
 *   1. by googlePlaceId (exact)
 *   2. by exact NORMALISED name within 100 m of the given coordinates
 *
 * Normalised name = lower-case, trimmed, apostrophes dropped, other punctuation turned into spaces, whitespace
 * collapsed. A name with ";" in it is a list of alternatives ("A;B"); two names match when ANY alternative of one
 * equals ANY alternative of the other.
 *
 * CONTAINMENT DOES NOT MATCH. "Toronto Public Library - Woodside Square" and "Woodside Square" are different
 * places (so are "Cineplex Cinemas Empress Walk" and "Empress Walk"): a branch and the mall it sits in.
 *
 * A match may be an OSM-imported row (googlePlaceId "osm_<type>_<id>"), which has no real Google id. See
 * attachGoogleId() for what is done then. A real Google id is NEVER overwritten.
 */
import { haversineMetres } from "./geo.js";

export const NAME_MATCH_RADIUS_METRES = 100;
const BBOX_DEGREES = 0.002; // >= 100 m in both axes at Canadian latitudes; the exact haversine check follows

/** Normalised alternatives of a name, e.g. "Tim Horton's; Tims" -> ["tim hortons", "tims"]. */
export function normalisedNames(name) {
    return String(name ?? "")
        .split(";")
        .map((part) => part.toLowerCase().replace(/['’‘`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim())
        .filter(Boolean);
}

/** True when any normalised alternative of a equals any of b. Exact equality only, never containment. */
export function namesMatchExactly(a, b) {
    const nb = new Set(normalisedNames(b));
    return normalisedNames(a).some((n) => nb.has(n));
}

export const isOsmId = (id) => typeof id === "string" && id.startsWith("osm_");

/**
 * @returns {Promise<{location: object, matchedBy: "googlePlaceId"|"name", distanceMetres?: number} | null>}
 */
export async function findExistingPlace(prisma, { googlePlaceId, name, lat, lng }, { include } = {}) {
    if (googlePlaceId) {
        const byId = await prisma.location.findUnique({ where: { googlePlaceId }, ...(include ? { include } : {}) });
        if (byId) return { location: byId, matchedBy: "googlePlaceId" };
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || normalisedNames(name).length === 0) return null;

    const candidates = await prisma.location.findMany({
        where: {
            latitude: { gte: lat - BBOX_DEGREES, lte: lat + BBOX_DEGREES },
            longitude: { gte: lng - BBOX_DEGREES, lte: lng + BBOX_DEGREES },
        },
        ...(include ? { include } : {}),
    });
    let best = null;
    for (const c of candidates) {
        const d = haversineMetres(lat, lng, c.latitude, c.longitude);
        if (d > NAME_MATCH_RADIUS_METRES || !namesMatchExactly(name, c.name)) continue;
        if (!best || d < best.distanceMetres) best = { location: c, matchedBy: "name", distanceMetres: d };
    }
    return best;
}

/**
 * Gives an existing row a real Google id, only when it has none.
 *   - googlePlaceId null or "osm_..."  -> set it to the real id. The row keeps its own id, scores, reviews, saves,
 *     check-ins, name, address, coordinates AND ITS CATEGORY SPELLING ("Cafe" from OSM is not rewritten to "cafe"; only a
 *     missing category is filled in). Nothing else is touched, so nothing is deleted or merged.
 *   - a real Google id (same or different) -> left exactly as it is.
 * The update is conditional on the id still being what we read, so a concurrent request cannot be overwritten.
 * @returns {Promise<{location: object, attached: boolean, reason?: string}>}
 */
export async function attachGoogleId(prisma, existing, { googlePlaceId, category }, { include } = {}) {
    const current = existing.googlePlaceId;
    if (current === googlePlaceId) return { location: existing, attached: false, reason: "already has this id" };
    if (current && !isOsmId(current)) return { location: existing, attached: false, reason: "has a different real Google id" };

    const data = { googlePlaceId };
    if (!existing.category && category) data.category = category;
    const { count } = await prisma.location.updateMany({ where: { id: existing.id, googlePlaceId: current }, data });
    if (count === 0) return { location: existing, attached: false, reason: "changed concurrently" };
    const location = await prisma.location.findUnique({ where: { id: existing.id }, ...(include ? { include } : {}) });
    return { location, attached: true };
}
