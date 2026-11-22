// Pure helpers for the place detail panel's labels (no DOM access, so they're unit-testable in Node).

// Sources the enrichment pipeline can currently record in Location.dataSource (comma-separated).
// yelp/foursquare stay here only so legacy rows written before those were disabled still read correctly.
const SOURCE_LABELS = {
    google: 'Google Places',
    toronto: 'City of Toronto open data',
    osm: 'OpenStreetMap tags',
    yelp: 'Yelp',
    foursquare: 'Foursquare',
};

// Shown when a location has no per-row source record: only the sources that are active today.
const ACTIVE_SOURCES_FALLBACK = ['Google Places', 'City of Toronto open data', 'OpenStreetMap tags'];

/** "google,toronto,osm" -> ['Google Places', 'City of Toronto open data', 'OpenStreetMap tags'] */
export function describeDataSources(dataSource) {
    const labels = String(dataSource ?? '')
        .split(',')
        .map((s) => SOURCE_LABELS[s.trim().toLowerCase()])
        .filter(Boolean);
    return labels.length > 0 ? [...new Set(labels)] : ACTIVE_SOURCES_FALLBACK;
}

export const joinList = (items) =>
    items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// Comfort is shown on a 0-5 scale; the estimated-score formula can exceed 5 (it is deliberately
// uncapped for ranking), so every display of it must clamp.
export const clampComfort = (c) => Math.min(5, Math.max(0, c ?? 0));

/**
 * Shares of the three sensory factors, summing to ~100. Comfort is NOT part of the sum — it is an
 * inverse of these loads, so including it made the three real factors look tiny.
 * `dominant` is null when the factors are effectively equal (spread < 0.25 on the 0-5 scale), so the
 * UI doesn't announce "Noise matters most" for a three-way tie.
 */
export function factorShares({ noise = 0, lighting = 0, crowd = 0 }) {
    const total = noise + lighting + crowd;
    if (!(total > 0)) return { noise: 0, lighting: 0, crowd: 0, dominant: null };
    const pct = (v) => Math.round((v / total) * 100);
    const spread = Math.max(noise, lighting, crowd) - Math.min(noise, lighting, crowd);
    let dominant = null;
    if (spread >= 0.25) {
        dominant = noise >= crowd && noise >= lighting ? 'noise' : crowd >= lighting ? 'crowd' : 'lighting';
    }
    return { noise: pct(noise), lighting: pct(lighting), crowd: pct(crowd), dominant };
}
