import { displayScoreForLocation, locationHasTrustworthyScores } from "./scores.js";

/**
 * Pins and search/list results. Scores come from the same display-score logic as the place panel, and only when the
 * place passes hasTrustworthyScores(); otherwise the three scores and comfort are null (never 0) and `trustworthy` is false,
 * so clients show "Not enough data yet" instead of a number.
 */
export const toGeoJSON = (locations) => {
    return {
        type: "FeatureCollection",
        features: locations.map((loc) => {
            const trustworthy = locationHasTrustworthyScores(loc);
            const display = trustworthy ? displayScoreForLocation(loc) : null;
            const mean = display ? (display.noise + display.lighting + display.crowd) / 3 : null;
            return {
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: [loc.longitude, loc.latitude],
                },
                properties: {
                    id: loc.id,
                    name: loc.name,
                    category: loc.category,
                    address: loc.address ?? null,
                    imageUrl: loc.imageUrl ?? null,
                    trustworthy,
                    noiseScore: display ? display.noise : null,
                    lightingScore: display ? display.lighting : null,
                    crowdScore: display ? display.crowd : null,
                    comfortScore: display ? (display.comfort ?? Math.max(1, 6 - mean)) : null,
                    reviewCount: loc.sensoryScores?.reviewCount ?? 0,
                    dataSource: loc.dataSource ?? 'category',
                },
            };
        }),
    };
};
