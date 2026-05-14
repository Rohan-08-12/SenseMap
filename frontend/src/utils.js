export const scoreToLabel = (s) => s < 2 ? 'Low' : s < 3.5 ? 'Medium' : 'High';

export const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    try {
        const s = JSON.parse(localStorage.getItem('sensorysafe_settings') || '{}');
        if (s.distanceUnit === 'mi') {
            const mi = km * 0.621371;
            return mi < 0.1 ? `${(mi * 5280).toFixed(0)}ft away` : `${mi.toFixed(1)}mi away`;
        }
    } catch { /* ignore */ }
    return km < 1 ? `${(km * 1000).toFixed(0)}m away` : `${km.toFixed(1)}km away`;
};
