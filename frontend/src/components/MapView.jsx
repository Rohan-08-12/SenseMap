import { useMemo, useCallback, useRef, useEffect } from 'react';
import Map, { Source, Layer } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || '';
const DEFAULT_MAP_STYLE = 'mapbox://styles/mapbox/light-v11';

const INITIAL_VIEW_STATE = {
    longitude: -79.3832,
    latitude: 43.6532,
    zoom: 12,
    pitch: 40,
    bearing: -10,
};

export default function MapView({ onLocationSelect, filter, searchResultsGeoJSON, heatmapEnabled, heatmapData, flyToLocation, userCoords, mapStyle, trafficEnabled }) {
    const mapRef = useRef(null);
    const hasFlownToUser = useRef(false);

    // Fly to user's location once on first load
    useEffect(() => {
        if (!userCoords || !mapRef.current || hasFlownToUser.current) return;
        hasFlownToUser.current = true;
        mapRef.current.flyTo({
            center: [userCoords.lng, userCoords.lat],
            zoom: 13,
            duration: 1200,
        });
    }, [userCoords]);

    // Fly to a selected location
    useEffect(() => {
        if (!flyToLocation || !mapRef.current) return;
        mapRef.current.flyTo({
            center: [flyToLocation.longitude, flyToLocation.latitude],
            zoom: flyToLocation.zoom || 16,
            duration: 1000,
        });
    }, [flyToLocation]);
    const normalizedHeatmap = useMemo(() => {
        if (!heatmapData?.length) return [];
        return heatmapData.map((d) => ({
            position: [d.longitude, d.latitude],
            id: d.locationId,
            name: d.name,
            category: d.category,
            comfort_score: d.comfortScore,
            noise_score: d.noiseScore,
            lighting_score: d.lightingScore,
            crowd_score: d.crowdScore,
            review_count: d.reviewCount,
        }));
    }, [heatmapData]);

    const baseData = useMemo(() => {
        if (searchResultsGeoJSON && searchResultsGeoJSON.features) {
            return searchResultsGeoJSON.features.map(f => ({
                position: f.geometry.coordinates,
                ...f.properties,
                noise_score: f.properties.noiseScore ?? null,
                lighting_score: f.properties.lightingScore ?? null,
                crowd_score: f.properties.crowdScore ?? null,
                comfort_score: f.properties.comfortScore ?? null,
                review_count: f.properties.reviewCount ?? 0,
            }));
        }
        return normalizedHeatmap;
    }, [searchResultsGeoJSON, normalizedHeatmap]);

    const filteredData = useMemo(() => {
        let data = baseData;
        if (filter) {
            const f = filter.toLowerCase();
            data = data.filter((d) => {
                const cat = (d.category || '').toLowerCase();
                if (f === 'quiet-now') return (d.noise_score ?? 5) < 2;
                if (f === 'before-noon') return (d.noise_score ?? 5) < 2.5;
                if (f === 'low-crowds') return (d.crowd_score ?? 5) < 2;
                if (f === 'soft-lighting') return (d.lighting_score ?? 5) < 2.5;
                if (f === 'outdoor') return /park|garden|outdoor|field|trail|beach|nature|forest|plaza|square/i.test(cat);
                if (f === 'cafes') return /cafe|coffee|bistro|bakery|tea/i.test(cat);
                if (f === 'parks') return /park|garden|field|green|nature|forest|trail|outdoor/i.test(cat);
                if (f === 'libraries') return /library|archive|reading/i.test(cat);
                if (f === 'museums') return /museum|gallery|exhibit|art/i.test(cat);
                if (f === 'community') return /community|centre|center|recreation|mall|shopping/i.test(cat);
                return true;
            });
        }
        return data;
    }, [baseData, filter]);

    // Single GeoJSON source for both heatmap and pins
    const geojson = useMemo(() => ({
        type: 'FeatureCollection',
        features: filteredData.map(d => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: d.position },
            properties: {
                id: d.id,
                name: d.name,
                category: d.category,
                comfort_score: Math.min(5, Math.max(1, d.comfort_score || 2.5)),
                noise_score: d.noise_score,
                lighting_score: d.lighting_score,
                crowd_score: d.crowd_score,
                review_count: d.review_count,
            },
        })),
    }), [filteredData]);

    const handleClick = useCallback((e) => {
        const features = e.features;
        if (!features?.length) return;
        const f = features[0];
        onLocationSelect?.({
            id: f.properties.id,
            name: f.properties.name,
            category: f.properties.category,
            comfort_score: f.properties.comfort_score,
            noise_score: f.properties.noise_score,
            lighting_score: f.properties.lighting_score,
            crowd_score: f.properties.crowd_score,
            review_count: f.properties.review_count,
            longitude: f.geometry.coordinates[0],
            latitude: f.geometry.coordinates[1],
        });
    }, [onLocationSelect]);

    return (
        <Map
            ref={mapRef}
            initialViewState={INITIAL_VIEW_STATE}
            mapStyle={mapStyle || DEFAULT_MAP_STYLE}
            mapboxAccessToken={MAPBOX_TOKEN}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
            interactiveLayerIds={['location-pins']}
            onClick={handleClick}
            cursor="auto"
        >
            {/* Mapbox real-time traffic layer */}
            {trafficEnabled && (
                <Source id="mapbox-traffic" type="vector" url="mapbox://mapbox.mapbox-traffic-v1">
                    <Layer
                        id="traffic-flow"
                        type="line"
                        source-layer="traffic"
                        paint={{
                            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4],
                            'line-color': [
                                'match', ['get', 'congestion'],
                                'low',      '#4ade80',
                                'moderate', '#fbbf24',
                                'heavy',    '#f97316',
                                'severe',   '#dc2626',
                                '#94a3b8',
                            ],
                            'line-opacity': 0.82,
                        }}
                    />
                </Source>
            )}

            <Source id="locations-source" type="geojson" data={geojson}>
                {/* Heatmap layer — below pins */}
                {heatmapEnabled && (
                    <Layer
                        id="comfort-heatmap"
                        type="heatmap"
                        paint={{
                            'heatmap-weight': [
                                'interpolate', ['linear'], ['get', 'comfort_score'],
                                1, 0.1,
                                3, 0.5,
                                5, 1.0,
                            ],
                            'heatmap-intensity': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 1,
                                15, 2,
                            ],
                            'heatmap-radius': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 20,
                                13, 40,
                                15, 60,
                            ],
                            'heatmap-opacity': 0.7,
                            'heatmap-color': [
                                'interpolate', ['linear'], ['heatmap-density'],
                                0,   'rgba(255,230,230,0)',
                                0.2, 'rgba(255,204,153,0.6)',
                                0.4, 'rgba(255,240,153,0.7)',
                                0.6, 'rgba(153,255,153,0.8)',
                                0.8, 'rgba(102,255,178,0.9)',
                                1.0, 'rgba(34,197,94,1)',
                            ],
                        }}
                    />
                )}

                {/* Circle pins — above heatmap, fully locked to map coordinates */}
                <Layer
                    id="location-pins"
                    type="circle"
                    paint={{
                        'circle-radius': [
                            'interpolate', ['linear'], ['zoom'],
                            10, 4,
                            13, 7,
                            16, 11,
                        ],
                        'circle-color': [
                            'interpolate', ['linear'], ['get', 'comfort_score'],
                            1, '#dc3c50',
                            2, '#f59e0b',
                            3, '#facc15',
                            4, '#4ade80',
                            5, '#22c55e',
                        ],
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#ffffff',
                        'circle-opacity': 0.92,
                    }}
                />
            </Source>
        </Map>
    );
}
