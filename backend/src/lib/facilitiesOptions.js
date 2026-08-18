// Canonical facilities pill options — kept in sync with frontend/src/components/SubmitReview.jsx.
// Shared between routes/reviews.js (validating user submissions) and lib/enrichmentCron.js
// (validating Gemini-inferred tags).
export const FACILITIES_OPTIONS = {
    temperature: ["Very cold", "Cool", "Comfortable", "Warm", "Hot", "Good airflow", "Stuffy"],
    seating: ["No seating", "Limited seating", "Plenty of seating", "Soft/couch seating", "Hard chairs only", "Standing only"],
    bathrooms: ["No public bathroom", "Public bathroom available", "Accessible bathroom", "Single stall", "Multiple stalls", "Gendered", "Unisex"],
    socialInteractions: [
        "Must speak to staff on entry",
        "No interaction required",
        "Electronic ordering available",
        "Self-checkout available",
        "Quiet/minimal staff interaction",
        "Can browse freely without being approached",
    ],
};

// Merges two { field: [tags] } facilities objects, category by category. `primary` wins for
// any category it has data for (used for OSM tags, which are exact/deterministic); `fallback`
// fills in only the categories `primary` has nothing for (used for Gemini's fuzzier inference
// from review text). Either argument may be null/undefined. Returns null if both are empty.
export function mergeFacilities(primary, fallback) {
    const merged = { ...(fallback || {}), ...(primary || {}) };
    return Object.keys(merged).length > 0 ? merged : null;
}
