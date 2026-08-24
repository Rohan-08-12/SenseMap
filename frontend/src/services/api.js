/**
 * Global Axios Instance & API Services
 * Configures base URL, request timeouts, and Auth0 JWT interceptors.
 * All backend API calls go through this file.
 */
import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '',
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// ─── Auth Token Support ──────────────────────────────────────
let tokenGetter = null;

export const setTokenGetter = (fn) => {
    tokenGetter = fn;
};

// ─── Request Interceptor (auth + logging) ────────────────────
api.interceptors.request.use(
    async (config) => {
        // Skip token fetch for known public GET routes to avoid blocking if Auth0 is slow/hanging
        const publicRoutes = ['/locations/heatmap', '/rankings'];
        const isPublic = config.method === 'get' && publicRoutes.some(route => config.url.includes(route));

        if (tokenGetter && !isPublic) {
            try {
                const token = await tokenGetter();
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
            } catch {
                // No token available (not logged in) — public endpoints still work
            }
        }
        return config;
    },
    (error) => {
        console.error('[API] Request error:', error);
        return Promise.reject(error);
    }
);

// ─── Response Interceptor ────────────────────────────────────
api.interceptors.response.use(
    (response) => response,
    (error) => Promise.reject(error)
);

// ═════════════════════════════════════════════════════════════
// ENDPOINT FUNCTIONS
// ═════════════════════════════════════════════════════════════

// ─── Locations (GeoJSON for map layers) ─────────────────────
export const getLocations = () => {
    return api.get('/locations');
};

export const getLocationById = (id) => {
    return api.get(`/locations/${id}`);
};

export const getLocationHours = (id) => {
    return api.get(`/locations/${id}/hours`);
};

export const getLocationHeatmap = () => {
    return api.get('/locations/heatmap', { timeout: 60000 });
};

export const getLocationMatch = () => {
    return api.get('/locations/match');
};

export const searchLocations = (query) => {
    return api.get('/locations/search', { params: { q: query } });
};

export const discoverLocations = (query, lat, lng) => {
    return api.get('/discover', { params: { q: query, lat, lng }, timeout: 20000 });
};

// ─── Reviews ────────────────────────────────────────────────
export const submitReview = (reviewData) => {
    return api.post('/reviews', reviewData);
};

export const getReviewsByLocation = (locationId) => {
    return api.get(`/reviews/${locationId}`);
};

// ─── Rankings ───────────────────────────────────────────────
export const getRankings = (sortBy = 'comfort_score') => {
    return api.get('/rankings', { params: { sort: sortBy }, timeout: 30000 });
};

// ─── Sensory Profile ────────────────────────────────────────
export const getSensoryProfile = () => {
    return api.get('/profiles/me');
};

export const updateSensoryProfile = (profileData) => {
    return api.put('/profiles/me', profileData);
};

// ─── AI Insights (Gemini) ───────────────────────────────────
export const getAIInsights = (locationId) => {
    return api.post(`/ai/insights/${locationId}`);
};

export const analyzeReview = (reviewText) => {
    return api.post('/ai/analyze', { text: reviewText });
};

// ─── Saved Places ───────────────────────────────────────────
export const getSavedPlaces = () => {
    return api.get('/saved-places');
};

export const savePlace = (locationId) => {
    return api.post('/saved-places', { locationId });
};

export const removeSavedPlace = (locationId) => {
    return api.delete(`/saved-places/${locationId}`);
};

// ─── Image Upload ───────────────────────────────────────────
export const uploadImage = (file) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
};

export const checkIn = (locationId) => {
    return api.post(`/checkins/${locationId}`);
};

export const getRecentCheckIns = () =>
    api.get('/checkins/recent');

export const getSimilarLocations = (locationId) =>
    api.get(`/locations/similar/${locationId}`);

export const checkNearbyConstruction = (lat, lng) =>
    api.get(`/locations/construction-check?lat=${lat}&lng=${lng}`);

export const deleteAccount = () =>
    api.delete('/users/me');

// ─── Audio Summaries ─────────────────────────────────────────
export const getLocationAudio = (locationId) =>
    api.get(`/audio/${locationId}`, { timeout: 30000 });

// ─── Email Subscription (weekly digest) ──────────────────────
export const subscribeEmail = (email, source) =>
    api.post('/subscribe', { email, source });

export default api;
