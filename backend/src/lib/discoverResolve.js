/**
 * Turns Google Text Search results into stored Location rows for GET /discover.
 *
 * COST RULES
 *  - Only the first RESULTS_CONSIDERED results are looked at, and looking is free (database only).
 *  - Results already stored (by Google id, or by the same exact name within 100 m, see findExistingPlace) cost nothing.
 *  - At most MAX_NEW_PER_SEARCH results that are NOT stored yet are created, taken in Google's order. Each creation is
 *    one Place Details call (plus one photo fetch in the background when the place has a photo).
 *
 * A stored OSM row (osm_* id) that matches by name gets the real Google id attached; it is never duplicated, and a
 * real Google id already on a row is never overwritten (see attachGoogleId).
 */
import { findExistingPlace, attachGoogleId } from "./findExistingPlace.js";

export const RESULTS_CONSIDERED = 10;
export const MAX_NEW_PER_SEARCH = 3;

export async function resolveGoogleResults(results, { prisma, getDetails, classifyCategory, inBounds, onCreated = () => {}, log = console.log }) {
    const considered = (results || []).slice(0, RESULTS_CONSIDERED);
    const include = { sensoryScores: true };
    const slots = new Array(considered.length).fill(null);
    const missing = [];

    await Promise.all(considered.map(async (place, i) => {
        const gpid = place?.place_id;
        if (!gpid) return;
        const lat = place.geometry?.location?.lat, lng = place.geometry?.location?.lng;
        const found = await findExistingPlace(prisma, { googlePlaceId: gpid, name: place.name, lat, lng }, { include });
        if (found) {
            if (found.matchedBy === "name") {
                const r = await attachGoogleId(prisma, found.location, { googlePlaceId: gpid }, { include });
                if (!r.attached) log(`[discover] "${place.name}" matches stored "${found.location.name}" (${found.location.id}), id left as is: ${r.reason}`);
                slots[i] = r.location;
            } else {
                slots[i] = found.location;
            }
            return;
        }
        if (inBounds(lat, lng)) missing.push({ i, place });
    }));

    missing.sort((a, b) => a.i - b.i);
    const toCreate = missing.slice(0, MAX_NEW_PER_SEARCH);
    if (missing.length > toCreate.length) log(`[discover] ${missing.length - toCreate.length} more new place(s) not stored (cap ${MAX_NEW_PER_SEARCH} per search)`);

    await Promise.allSettled(toCreate.map(async ({ i, place }) => {
        const gpid = place.place_id;
        const details = await getDetails(gpid);
        if (!details) return;
        let location;
        try {
            location = await prisma.location.create({
                data: {
                    googlePlaceId: gpid,
                    name: details.name,
                    description: details.editorial_summary?.overview || null,
                    category: classifyCategory(details.types),
                    address: details.formatted_address,
                    latitude: details.geometry.location.lat,
                    longitude: details.geometry.location.lng,
                },
            });
        } catch (err) {
            // another request stored it first (unique googlePlaceId): use that row
            const again = await prisma.location.findUnique({ where: { googlePlaceId: gpid }, include });
            if (!again) throw err;
            slots[i] = again;
            return;
        }
        slots[i] = { ...location, sensoryScores: null };
        onCreated(location, details);
    }));

    return slots.filter(Boolean);
}
