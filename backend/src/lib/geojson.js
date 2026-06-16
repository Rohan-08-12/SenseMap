export const toGeoJSON = (locations) => {
    return {
        type: "FeatureCollection",
        features: locations.map((loc) => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [loc.longitude, loc.latitude],
            },
            properties: {
                id: loc.id,
                name: loc.name,
                category: loc.category,
                imageUrl: loc.imageUrl ?? null,
                noiseScore: loc.sensoryScores?.noiseScore ?? loc.estimatedNoiseScore ?? null,
                lightingScore: loc.sensoryScores?.lightingScore ?? loc.estimatedLightingScore ?? null,
                crowdScore: loc.sensoryScores?.crowdScore ?? loc.estimatedCrowdScore ?? null,
                comfortScore: loc.sensoryScores?.comfortScore ?? (loc.estimatedNoiseScore != null && loc.estimatedCrowdScore != null && loc.estimatedLightingScore != null ? +(((5 - loc.estimatedNoiseScore) * 0.4 + (5 - loc.estimatedCrowdScore) * 0.4 + loc.estimatedLightingScore * 0.2)).toFixed(1) : null),
                reviewCount: loc.sensoryScores?.reviewCount ?? 0,
                dataSource: loc.dataSource ?? 'category',
            },
        })),
    };
};