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
