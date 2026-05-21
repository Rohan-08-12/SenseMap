import { useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useTheme } from '../theme/ThemeContext.jsx';
import { scoreToLabel, haversineDistance } from '../utils.js';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import MapView from './MapView';
import Dashboard from './Dashboard';
import SavedPlaces from './SavedPlaces';
import SensoryProfile from './SensoryProfile';
import Settings from './Settings';
import LogoutConfirmation from './LogoutConfirmation';
import SubmitReview from './SubmitReview'; // NEW
import { getRankings, getLocationHeatmap, getLocationMatch, getSensoryProfile, updateSensoryProfile, getLocationById, getLocationHours, getAIInsights, discoverLocations, getSavedPlaces, savePlace, removeSavedPlace, checkIn, submitReview, getSimilarLocations, checkNearbyConstruction } from '../services/api';
import './LoggedInMapView.css';

const SETTINGS_KEY = 'sensorysafe_settings';

function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 2) return '⛅';
  if (code <= 3) return '☁️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌧️';
  return '⛈️';
}

const MAP_STYLE_URLS = {
  default: 'mapbox://styles/mapbox/light-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
  dark: 'mapbox://styles/mapbox/dark-v11',
};

const FONT_ZOOM = { small: '0.875', medium: '1', large: '1.125' };

function applyDomSettings(s) {
  document.documentElement.setAttribute('data-high-contrast', s.highContrast ? 'true' : 'false');
  document.documentElement.setAttribute('data-reduced-motion', s.reducedMotion ? 'true' : 'false');
  document.documentElement.style.zoom = FONT_ZOOM[s.fontSize] || '1';
  // Let Mapbox know the canvas dimensions changed after zoom
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

const NAV_ITEMS = [
  { id: 'explore', label: 'Explore map', icon: 'map' },
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'saved', label: 'Saved places', icon: 'bookmark' },
  { id: 'profile', label: 'Sensory profile', icon: 'sliders' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function NavIcon({ type, active }) {
  const color = active ? 'var(--theme-accent)' : 'var(--theme-text)';
  const icons = {
    map: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M1.5 4.5L6.5 1.5L11.5 4.5L16.5 1.5V13.5L11.5 16.5L6.5 13.5L1.5 16.5V4.5Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 1.5V13.5" stroke={color} strokeWidth="1.5" /><path d="M11.5 4.5V16.5" stroke={color} strokeWidth="1.5" /></svg>,
    grid: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.25" y="2.25" width="5.25" height="5.25" rx="1" stroke={color} strokeWidth="1.5" /><rect x="10.5" y="2.25" width="5.25" height="5.25" rx="1" stroke={color} strokeWidth="1.5" /><rect x="2.25" y="10.5" width="5.25" height="5.25" rx="1" stroke={color} strokeWidth="1.5" /><rect x="10.5" y="10.5" width="5.25" height="5.25" rx="1" stroke={color} strokeWidth="1.5" /></svg>,
    bookmark: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M14.25 15.75L9 12L3.75 15.75V3.75C3.75 3.35218 3.90804 2.97064 4.18934 2.68934C4.47064 2.40804 4.85218 2.25 5.25 2.25H12.75C13.1478 2.25 13.5294 2.40804 13.8107 2.68934C14.092 2.97064 14.25 3.35218 14.25 3.75V15.75Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
    sliders: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><line x1="3" y1="6" x2="15" y2="6" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><line x1="3" y1="12" x2="15" y2="12" stroke={color} strokeWidth="1.5" strokeLinecap="round" /><circle cx="6.75" cy="6" r="1.5" fill="white" stroke={color} strokeWidth="1.5" /><circle cx="11.25" cy="12" r="1.5" fill="white" stroke={color} strokeWidth="1.5" /></svg>,
    settings: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="2.25" stroke={color} strokeWidth="1.5" /><path d="M14.55 11.25a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-1.42 3.42 2 2 0 01-1.41-.59l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V16.5a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-3.42-1.42 2 2 0 01.59-1.41l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H1.5a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82L2.71 2.71a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H7.5a1.65 1.65 0 001-1.51V1.5a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.08a1.65 1.65 0 001.51 1h.17a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  };
  return icons[type] || null;
}

function SkeletonBlock({ width = '100%', height = 16 }) {
  return <div className="animate-pulse" style={{ width, height, background: '#e5e7eb', borderRadius: 6 }} />;
}

function LoggedInMapView({ onBackToHome, initialSearchQuery, initialFilter, onLogout }) {
  const { user, getAccessTokenSilently } = useAuth0();
  const { theme, setTheme } = useTheme();

  const [activeNav, setActiveNav] = useState('explore');
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery ?? '');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState(initialFilter ?? null);
  const [heatmapOn, setHeatmapOn] = useState(true);
  const [trafficOn, setTrafficOn] = useState(false);
  const [locationHours, setLocationHours] = useState(null);
  const [locationWeather, setLocationWeather] = useState(null);
  const [nearbyConstruction, setNearbyConstruction] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false); // NEW

  const [heatmapData, setHeatmapData] = useState([]);
  const [matchScores, setMatchScores] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [locationDetail, setLocationDetail] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [userCoords, setUserCoords] = useState(null);
  const [avgRating, setAvgRating] = useState(null);
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [savedPlaceIds, setSavedPlaceIds] = useState(new Set());
  const [savedPlacesList, setSavedPlacesList] = useState([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [flyToLocation, setFlyToLocation] = useState(null);
  const [mapStyleUrl, setMapStyleUrl] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return MAP_STYLE_URLS[s.mapStyle] || MAP_STYLE_URLS.default;
    } catch { return MAP_STYLE_URLS.default; }
  });
  const [similarLocations, setSimilarLocations] = useState([]);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInError, setCheckInError] = useState(null);
  const [showQuickRating, setShowQuickRating] = useState(false);
  const [quickRatingSubmitted, setQuickRatingSubmitted] = useState(false);
  const [quickSelections, setQuickSelections] = useState({ noise: null, lighting: null, crowd: null });

  // Apply accessibility + appearance settings from localStorage on mount
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      applyDomSettings(s);
    } catch { /* ignore */ }
  }, []);

  const handleSettingsChange = useCallback((s) => {
    applyDomSettings(s);
    setMapStyleUrl(MAP_STYLE_URLS[s.mapStyle] || MAP_STYLE_URLS.default);
  }, []);

  const buildSnapshot = useCallback((data, coords) => {
    if (!Array.isArray(data) || data.length === 0) return;
    const nearby = coords
      ? data.filter((l) => {
        if (l.latitude == null || l.longitude == null) return false;
        const R = 6371;
        const dLat = ((l.latitude - coords.lat) * Math.PI) / 180;
        const dLon = ((l.longitude - coords.lng) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((coords.lat * Math.PI) / 180) * Math.cos((l.latitude * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) < 10;
      })
      : data;
    const calmCount = nearby.filter((l) => (l.comfortScore ?? 0) > 3.5).length;
    const avgNoise = nearby.length > 0 ? nearby.reduce((a, b) => a + (b.noiseScore ?? 0), 0) / nearby.length : 0;
    const avgComfort = nearby.length > 0 ? nearby.reduce((a, b) => a + (b.comfortScore ?? 0), 0) / nearby.length : 0;
    const hour = new Date().getHours();
    const bestWindow = hour < 10 ? 'Morning' : hour < 14 ? 'Midday' : hour < 17 ? 'Afternoon' : 'Evening';
    setSnapshot({ calmCount, noiseTrend: scoreToLabel(avgNoise), avgComfort, bestWindow });
  }, []);

  useEffect(() => {
    if (heatmapData.length > 0 && userCoords) {
      buildSnapshot(heatmapData, userCoords);
    }
  }, [userCoords, heatmapData, buildSnapshot]);

  // --- Mount: fetch heatmap, rankings, geolocation ---
  useEffect(() => {
    getLocationHeatmap()
      .then((res) => {
        const data = res.data;
        if (Array.isArray(data)) {
          setHeatmapData(data);
          buildSnapshot(data, null);
        }
      })
      .catch(() => { });

    getRankings()
      .then((res) => {
        const data = res.data;
        if (Array.isArray(data) && data.length > 0) {
          setNearbyPlaces(data.slice(0, 6).map((loc) => ({
            name: loc.name,
            score: loc.comfortScore ?? 0,
            tags: loc.category || 'Sensory-friendly',
            desc: `Noise: ${(loc.noiseScore || 0).toFixed(1)} · Lighting: ${(loc.lightingScore || 0).toFixed(1)} · Crowd: ${(loc.crowdScore || 0).toFixed(1)}`,
            tier: (loc.comfortScore ?? 0) >= 3.5 ? 'high' : 'medium',
            featured: false,
            comfort_score: loc.comfortScore,
            noise_score: loc.noiseScore,
            lighting_score: loc.lightingScore,
            crowd_score: loc.crowdScore,
            id: loc.locationId,
            latitude: loc.latitude,
            longitude: loc.longitude,
            category: loc.category,
          })));
        }
      })
      .catch((err) => {
        console.error('Failed to fetch rankings:', err);
      });

    navigator.geolocation?.getCurrentPosition(
      (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserCoords(null)
    );
  }, []); // Only run on mount!

  // --- Auth: fetch protected data when token is available ---
  useEffect(() => {
    const fetchProtected = async () => {
      try {
        const token = await getAccessTokenSilently({ authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE } });
        if (token) {
          getLocationMatch().then((res) => setMatchScores(res.data || [])).catch(() => { });
          getSensoryProfile().then((res) => setUserProfile(res.data || null)).catch(() => { });
          getSavedPlaces()
            .then((res) => {
              const list = Array.isArray(res.data) ? res.data : [];
              setSavedPlacesList(list);
              setSavedPlaceIds(new Set(list.map((s) => s.location?.id || s.locationId).filter(Boolean)));
            })
            .catch(() => { });
        }
      } catch {
        // no token available — protected data will be unavailable
      }
    };

    fetchProtected();
  }, [getAccessTokenSilently]);

  // --- On mount: run search if opened from launch with a query ---
  useEffect(() => {
    if (!initialSearchQuery?.trim()) return;
    setSearchLoading(true);
    discoverLocations(initialSearchQuery.trim(), userCoords?.lat, userCoords?.lng)
      .then((res) => setSearchResults(res.data))
      .catch(() => setSearchResults({ features: [] }))
      .finally(() => setSearchLoading(false));
  }, [initialSearchQuery]);

  // --- Reusable: re-fetch location detail + AI insights ---
  const refreshLocationData = useCallback(async (locId) => {
    if (!locId) return;
    getLocationById(locId)
      .then((res) => {
        const detail = res.data;
        setLocationDetail(detail);
        if (detail?.reviews?.length > 0) {
          const avg = detail.reviews.reduce((a, b) => a + (b.rating || 0), 0) / detail.reviews.length;
          setAvgRating(avg);
        }
      })
      .catch(() => { });

    try {
      setAiLoading(true);
      await getAccessTokenSilently({ authorizationParams: { audience: import.meta.env.VITE_AUTH0_AUDIENCE } });
      const res = await getAIInsights(locId);
      setAiInsights(res.data);
    } catch { /* AI not available */ }
    finally { setAiLoading(false); }
  }, [getAccessTokenSilently]);

  // Reset UI state only when the selected location actually changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedLocation) return;
    setAiInsights(null);
    setLocationDetail(null);
    setAvgRating(null);
    setShowReviewForm(false);
    setCheckedIn(false);
    setLocationHours(null);
    setLocationWeather(null);
    setNearbyConstruction(false);

    const lat = selectedLocation.latitude;
    const lng = selectedLocation.longitude;

    if (selectedLocation.id) {
      getLocationHours(selectedLocation.id)
        .then((res) => setLocationHours(res.data))
        .catch(() => {});
    }

    if (lat != null && lng != null) {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&temperature_unit=celsius&forecast_days=1`)
        .then((r) => r.json())
        .then((d) => { if (d.current) setLocationWeather({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code }); })
        .catch(() => {});

      checkNearbyConstruction(lat, lng)
        .then((res) => { if (res.data?.nearby) setNearbyConstruction(true); })
        .catch(() => {});
    }
  }, [selectedLocation?.id]);

  // Fetch detail + AI (also re-runs when refreshLocationData stabilizes after auth)
  useEffect(() => {
    if (!selectedLocation) return;
    refreshLocationData(selectedLocation.id);
  }, [selectedLocation, refreshLocationData]);

  // Fetch similar locations when selection changes
  useEffect(() => {
    if (!selectedLocation?.id) { setSimilarLocations([]); return; }
    getSimilarLocations(selectedLocation.id)
      .then((res) => setSimilarLocations(res.data || []))
      .catch(() => setSimilarLocations([]));
  }, [selectedLocation?.id]);

  const handleLocationSelect = (location) => {
    setSelectedLocation(location);
  };

  const handleNavClick = (item) => {
    setActiveNav(item.id);
  };

  const handleSearchSubmit = async (e) => {
    e?.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await discoverLocations(searchQuery.trim(), userCoords?.lat, userCoords?.lng);
      setSearchResults(res.data);
    } catch {
      setSearchResults({ features: [] });
    } finally {
      setSearchLoading(false);
    }
  };

  const handleCalmRoute = () => {
    setActiveFilter((prev) => prev === 'quiet-now' ? null : 'quiet-now');
  };

  const handlePersonalize = () => {
    setActiveNav('profile');
  };

  const refreshSavedPlaces = () => {
    getSavedPlaces()
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : [];
        setSavedPlacesList(list);
        setSavedPlaceIds(new Set(list.map((s) => s.location?.id || s.locationId).filter(Boolean)));
      })
      .catch(() => { });
  };

  const handleToggleSaved = async () => {
    const locId = selectedLocation?.id;
    if (!locId || saveLoading) return;
    const isSaved = savedPlaceIds.has(locId);
    setSaveLoading(true);
    try {
      if (isSaved) {
        await removeSavedPlace(locId);
        setSavedPlaceIds((prev) => {
          const next = new Set(prev);
          next.delete(locId);
          return next;
        });
      } else {
        await savePlace(locId);
        setSavedPlaceIds((prev) => new Set([...prev, locId]));
      }
      refreshSavedPlaces();
    } catch {
      // keep state unchanged on error
    } finally {
      setSaveLoading(false);
    }
  };

  const handleCheckIn = async () => {
    const locId = selectedLocation?.id;
    if (!locId || checkInLoading) return;
    setCheckInError(null);
    setCheckInLoading(true);

    // Option 1 — GPS proximity check
    const withinRange = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(true); // fallback: allow if no GPS
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: uLat, longitude: uLng } = pos.coords;
          const locLat = selectedLocation?.latitude;
          const locLng = selectedLocation?.longitude;
          if (!locLat || !locLng) return resolve(true);
          // Haversine distance in metres
          const R = 6371000;
          const dLat = (locLat - uLat) * Math.PI / 180;
          const dLng = (locLng - uLng) * Math.PI / 180;
          const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(uLat * Math.PI / 180) * Math.cos(locLat * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
          const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          resolve(dist <= 200);
        },
        () => resolve(true), // GPS denied → allow anyway
        { timeout: 5000 }
      );
    });

    if (!withinRange) {
      setCheckInError("You need to be at this location to check in.");
      setCheckInLoading(false);
      setTimeout(() => setCheckInError(null), 4000);
      return;
    }

    try {
      await checkIn(locId);
      setCheckedIn(true);
      // Option 3 — show quick rating prompt after successful check-in
      setTimeout(() => {
        setShowQuickRating(true);
      }, 600);
      setTimeout(() => setCheckedIn(false), 4000);
    } catch (err) {
      // Option 2 — handle cooldown error from backend
      const msg = err?.response?.data?.message;
      if (err?.response?.status === 429 && msg) {
        setCheckInError(msg);
        setTimeout(() => setCheckInError(null), 5000);
      }
    } finally {
      setCheckInLoading(false);
    }
  };

  const handleQuickPick = async (dimension, value) => {
    const locId = selectedLocation?.id;
    if (!locId) return;

    const updated = { ...quickSelections, [dimension]: value };
    setQuickSelections(updated);

    // Auto-submit once all 3 are selected
    if (updated.noise !== null && updated.lighting !== null && updated.crowd !== null) {
      // Map low/high picks to 1–10 sensory levels
      const levelFor = (pick) => pick === 'low' ? 2 : 8;
      const noiseLevel    = levelFor(updated.noise);
      const lightingLevel = levelFor(updated.lighting);
      const crowdLevel    = levelFor(updated.crowd);
      // Rating: fewer stimuli = more comfortable
      const avg = (noiseLevel + lightingLevel + crowdLevel) / 3;
      const rating = avg <= 3 ? 5 : avg <= 6 ? 3 : 1;

      // Build a descriptive sentence so Gemini has real text to analyze
      const noiseText    = updated.noise    === 'low' ? 'quiet with minimal noise' : 'noisy';
      const lightingText = updated.lighting === 'low' ? 'dim, soft lighting'       : 'bright lighting';
      const crowdText    = updated.crowd    === 'low' ? 'very few people around'   : 'quite busy and crowded';
      const bodyText = `Right now it is ${noiseText}, has ${lightingText}, and is ${crowdText}.`;

      try {
        await submitReview({ locationId: locId, bodyText, noiseLevel, lightingLevel, crowdLevel, rating });
        refreshLocationData(locId);
      } catch { /* silent */ }

      setQuickRatingSubmitted(true);
      setTimeout(() => {
        setShowQuickRating(false);
        setQuickRatingSubmitted(false);
        setQuickSelections({ noise: null, lighting: null, crowd: null });
      }, 2000);
    }
  };

  // --- Derived values ---
  const sensory = locationDetail?.sensoryScores || selectedLocation || {};
  const locName = selectedLocation?.name || 'Select a location';
  const comfortScore = (sensory.comfortScore ?? sensory.comfort_score ?? 0).toFixed(1);
  const noiseVal = sensory.noiseScore ?? sensory.noise_score ?? 0;
  const noiseLevel = scoreToLabel(noiseVal);

  const currentMatch = selectedLocation?.id
    ? matchScores.find((m) => m.locationId === selectedLocation.id)
    : null;
  const matchPercent = currentMatch?.matchScore ?? null;

  // Comfort score breakdown
  const total = (sensory.noiseScore ?? sensory.noise_score ?? 0) +
    (sensory.crowdScore ?? sensory.crowd_score ?? 0) +
    (sensory.lightingScore ?? sensory.lighting_score ?? 0) +
    (sensory.comfortScore ?? sensory.comfort_score ?? 0);
  const breakdown = total > 0 ? {
    noise: ((sensory.noiseScore ?? sensory.noise_score ?? 0) / total * 100).toFixed(0),
    crowd: ((sensory.crowdScore ?? sensory.crowd_score ?? 0) / total * 100).toFixed(0),
    lighting: ((sensory.lightingScore ?? sensory.lighting_score ?? 0) / total * 100).toFixed(0),
    comfort: ((sensory.comfortScore ?? sensory.comfort_score ?? 0) / total * 100).toFixed(0),
  } : { noise: '0', crowd: '0', lighting: '0', comfort: '0' };

  // Location tags from AI or sensory scores
  const locationTags = (() => {
    if (aiInsights?.tags?.length > 0) return aiInsights.tags;
    const tags = [];
    const ns = sensory.noiseScore ?? sensory.noise_score ?? 3;
    const ls = sensory.lightingScore ?? sensory.lighting_score ?? 3;
    const cs = sensory.crowdScore ?? sensory.crowd_score ?? 3;
    const cfs = sensory.comfortScore ?? sensory.comfort_score ?? 3;
    if (ns < 2) tags.push('Very quiet');
    if (ls < 2) tags.push('Dim lighting');
    else if (ls >= 2 && ls < 3.5) tags.push('Soft daylight');
    if (cs < 2) tags.push('Low crowds');
    if (cfs > 3.5) tags.push('Highly comfortable');
    return tags.length > 0 ? tags : ['Sensory-friendly'];
  })();

  // Noise chart data
  const baseNoise = sensory.noiseScore ?? sensory.noise_score ?? 2.5;
  const noiseChartData = [
    { time: 'Morning', noise: +(baseNoise * 0.5).toFixed(1), calm: +(5 - baseNoise * 0.5).toFixed(1) },
    { time: '10am', noise: +(baseNoise * 0.7).toFixed(1), calm: +(5 - baseNoise * 0.7).toFixed(1) },
    { time: 'Noon', noise: +(baseNoise * 1.0).toFixed(1), calm: +(5 - baseNoise * 1.0).toFixed(1) },
    { time: '4pm', noise: +(baseNoise * 1.2).toFixed(1), calm: +(5 - baseNoise * 1.2).toFixed(1) },
    { time: 'Evening', noise: +(baseNoise * 1.4).toFixed(1), calm: +(5 - baseNoise * 1.4).toFixed(1) },
  ];

  // Radar chart data
  const radarData = [
    { axis: 'Noise', value: (sensory.noiseScore ?? sensory.noise_score ?? 0) * 2 },
    { axis: 'Lighting', value: (sensory.lightingScore ?? sensory.lighting_score ?? 0) * 2 },
    { axis: 'Crowds', value: (sensory.crowdScore ?? sensory.crowd_score ?? 0) * 2 },
    { axis: 'Comfort', value: (sensory.comfortScore ?? sensory.comfort_score ?? 0) * 2 },
  ];

  // Possible triggers
  const triggers = (() => {
    const t = [];
    const ns = sensory.noiseScore ?? sensory.noise_score ?? 0;
    const cs = sensory.crowdScore ?? sensory.crowd_score ?? 0;
    const ls = sensory.lightingScore ?? sensory.lighting_score ?? 0;
    if (ns > 3) t.push('High noise levels expected');
    if (cs > 3) t.push('Dense crowds likely');
    if (ls > 3.5) t.push('Bright lighting throughout');
    return t;
  })();

  const triggerTip = (() => {
    const cs = sensory.crowdScore ?? sensory.crowd_score ?? 0;
    const ns = sensory.noiseScore ?? sensory.noise_score ?? 0;
    if (cs > 3) return 'Visit before 11am for fewer crowds.';
    if (ns > 3) return 'Morning visits are quieter.';
    return null;
  })();

  // Match checks
  const matchChecks = (() => {
    if (!userProfile || !selectedLocation) return [];
    const checks = [];
    const ns = sensory.noiseScore ?? sensory.noise_score ?? 0;
    const ls = sensory.lightingScore ?? sensory.lighting_score ?? 0;
    const cs = sensory.crowdScore ?? sensory.crowd_score ?? 0;
    const cfs = sensory.comfortScore ?? sensory.comfort_score ?? 0;
    if (ns <= (userProfile.noiseTolerance ?? 3) + 1) checks.push('Noise level matches your tolerance');
    if (ls <= (userProfile.lightingTolerance ?? 3) + 1) checks.push('Lighting suits your sensitivity');
    if (cs <= (userProfile.crowdTolerance ?? 3) + 1) checks.push('Crowd density fits your comfort zone');
    if (cfs > 3) checks.push('Overall comfort score is high');
    return checks;
  })();

  const reviewCount = locationDetail?.sensoryScores?.reviewCount ?? locationDetail?.reviews?.length ?? 0;

  const bestTimeText = aiInsights?.bestTime || (snapshot?.bestWindow ?? '—');

  const getDistance = useCallback((loc) => {
    if (!userCoords) return '— km away';
    const lat = loc.latitude ?? loc.position?.[1];
    const lng = loc.longitude ?? loc.position?.[0];
    if (lat == null || lng == null) return '— km away';
    return haversineDistance(userCoords.lat, userCoords.lng, lat, lng);
  }, [userCoords]);

  return (
    <div className={`lmv${selectedLocation ? ' lmv--has-detail' : ''}`}>
      {/* Left Nav */}
      <nav className="lmv-nav">
        <div className="lmv-nav-logo">
          <div className="lmv-nav-logo-icon">
            <img src="/favicon.png" alt="" />
          </div>
          <div className="lmv-nav-logo-text">
            <h1>SenseMap</h1>
          </div>
        </div>

        <div className="lmv-nav-links">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`lmv-nav-link${activeNav === item.id ? ' active' : ''}`}
              onClick={() => handleNavClick(item)}
              aria-label={item.label}
            >
              <NavIcon type={item.icon} active={activeNav === item.id} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="lmv-nav-spacer" />

        <div className="lmv-theme-switcher" role="group" aria-label="Theme">
          {['nature', 'calm'].map((t) => (
            <button
              key={t}
              type="button"
              className={`lmv-theme-btn lmv-theme-btn--text ${theme === t ? 'active' : ''}`}
              onClick={() => setTheme(t)}
              aria-pressed={theme === t}
              aria-label={`${t.charAt(0).toUpperCase() + t.slice(1)} theme`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="lmv-nav-user" onClick={() => setShowLogoutModal(true)} style={{ cursor: 'pointer' }}>
          <div className="lmv-nav-avatar">
            {user?.picture ? (
              <img src={user.picture} alt="" />
            ) : (
              <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--theme-accent), var(--theme-accent-soft))' }} />
            )}
          </div>
          <div className="lmv-nav-user-info">
            <h4>{user?.name ? (user.name.length > 14 ? user.name.substring(0, 14) + '…' : user.name) : 'User'}</h4>
            <p>{userProfile ? `Noise tol: ${userProfile.noiseTolerance ?? '—'}` : 'Loading profile…'}</p>
          </div>
          <div className="lmv-nav-user-chevron">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
      </nav>

      {activeNav === 'settings' ? (
        <Settings
          user={user}
          userProfile={userProfile}
          onLogout={() => setShowLogoutModal(true)}
          onSettingsChange={handleSettingsChange}
        />
      ) : activeNav === 'profile' ? (
        <SensoryProfile
          userProfile={userProfile}
          onSave={async (data) => {
            try {
              const res = await updateSensoryProfile(data);
              setUserProfile(res.data);
            } catch { /* ignore */ }
          }}
        />
      ) : activeNav === 'saved' ? (
        <SavedPlaces
          savedPlacesList={savedPlacesList}
          userCoords={userCoords}
          userProfile={userProfile}
          matchScores={matchScores}
          onRemovePlace={async (locId) => {
            try {
              await removeSavedPlace(locId);
              refreshSavedPlaces();
            } catch { /* ignore */ }
          }}
          onBack={() => setActiveNav('explore')}
        />
      ) : activeNav === 'dashboard' ? (
        <Dashboard
          userProfile={userProfile}
          savedPlacesList={savedPlacesList}
          bestMatch={matchScores?.[0] ?? null}
          userCoords={userCoords}
          snapshot={snapshot}
          onEditProfile={() => setActiveNav('profile')}
          onViewAllSaved={() => setActiveNav('saved')}
          onCalmRoute={() => { setActiveNav('explore'); setActiveFilter((prev) => prev === 'quiet-now' ? null : 'quiet-now'); }}
          onSearchGo={(query) => {
            setSearchQuery(query);
            setActiveNav('explore');
            setSearchLoading(true);
            discoverLocations(query.trim(), userCoords?.lat, userCoords?.lng)
              .then((res) => setSearchResults(res.data))
              .catch(() => setSearchResults({ features: [] }))
              .finally(() => setSearchLoading(false));
          }}
        />
      ) : (
        <>
          {/* Center Main */}
          <main className="lmv-main">
            {/* Comfort Snapshot */}
            <div className="lmv-snapshot">
              <div className="lmv-snapshot-header">
                <div className="lmv-snapshot-title">
                  <span>Today</span>
                  <h2>Comfort snapshot</h2>
                </div>
                {snapshot && snapshot.avgComfort > 3 && (
                  <span className="lmv-calm-badge">Calm now</span>
                )}
              </div>

              <div className="lmv-snapshot-stats">
                <div className="lmv-snapshot-big">
                  {snapshot ? (
                    <>
                      <span className="big-number">{snapshot.calmCount}</span>
                      <span className="big-label">calm places nearby</span>
                    </>
                  ) : (
                    <SkeletonBlock width={120} height={38} />
                  )}
                </div>
                <div className="lmv-snapshot-divider" />
                <div className="lmv-snapshot-cards">
                  <div className="lmv-stat-card">
                    <div className="stat-label">Best window</div>
                    <div className="stat-value">{snapshot?.bestWindow ?? '—'}</div>
                  </div>
                  <div className="lmv-stat-card">
                    <div className="stat-label">Noise trend</div>
                    <div className="stat-value">{snapshot?.noiseTrend ?? '—'}</div>
                  </div>
                </div>
              </div>

              <div className="lmv-snapshot-tags">
                {snapshot && snapshot.noiseTrend === 'Low' && (
                  <span className="lmv-tag green">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.25 7A5.25 5.25 0 111.75 7a5.25 5.25 0 0110.5 0z" stroke="#05360d" strokeWidth="1.2" /><path d="M4.5 7l2 2 3.5-3.5" stroke="#05360d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Low noise nearby
                  </span>
                )}
                {snapshot && snapshot.noiseTrend !== 'Low' && (
                  <span className="lmv-tag gray">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.75L8.75 5.25L12.25 5.83L9.625 8.4L10.25 12.25L7 10.5L3.75 12.25L4.375 8.4L1.75 5.83L5.25 5.25Z" stroke="#0f1720" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Best time: {snapshot.bestWindow}
                  </span>
                )}
              </div>
            </div>

            {/* Map */}
            <div className="lmv-map-section">
              <div className="lmv-map-inner">
                <MapView
                  onLocationSelect={handleLocationSelect}
                  filter={activeFilter}
                  searchResultsGeoJSON={searchResults}
                  selectedLocationId={selectedLocation?.id}
                  selectedLocation={selectedLocation}
                  flyToLocation={flyToLocation}
                  userCoords={userCoords}
                  heatmapData={heatmapData}
                  heatmapEnabled={heatmapOn}
                  trafficEnabled={trafficOn}
                  mapStyle={mapStyleUrl}
                />
              </div>

              {/* SubmitReview slide-in — layered over the map */}
              {showReviewForm && selectedLocation && (
                <SubmitReview
                  location={selectedLocation}
                  onClose={() => setShowReviewForm(false)}
                  onSubmitted={() => {
                    setShowReviewForm(false);
                    if (selectedLocation?.id) refreshLocationData(selectedLocation.id);
                  }}
                />
              )}

              <div className="lmv-map-legend">
                <span className="lmv-legend-chip calm">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.25 7A5.25 5.25 0 111.75 7a5.25 5.25 0 0110.5 0z" stroke="#05360d" strokeWidth="1.2" /><path d="M4.5 7l2 2 3.5-3.5" stroke="#05360d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Calm
                </span>
                <span className="lmv-legend-chip moderate">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.25" stroke="#4a2a00" strokeWidth="1.2" /><circle cx="7" cy="7" r="1.5" fill="#4a2a00" /></svg>
                  Moderate
                </span>
                <span className="lmv-legend-chip overwhelming">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.25" stroke="#4a0f00" strokeWidth="1.2" /><path d="M5 5l4 4M9 5l-4 4" stroke="#4a0f00" strokeWidth="1.2" strokeLinecap="round" /></svg>
                  Overwhelming
                </span>
              </div>

              <div className="lmv-map-toggle" style={{ position: 'absolute', top: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999 }}>
                <button
                  className="lmv-map-time-filter"
                  onClick={() => setActiveFilter((prev) => prev === 'before-noon' ? null : 'before-noon')}
                  style={{ cursor: 'pointer', border: activeFilter === 'before-noon' ? '2px solid var(--theme-accent)' : '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#0f1720" strokeWidth="1.3" /><path d="M8 4V8L10.5 9.5" stroke="#0f1720" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Before 11am
                </button>
                <button
                  className="lmv-map-time-filter"
                  onClick={() => setHeatmapOn((prev) => !prev)}
                  style={{ cursor: 'pointer', border: heatmapOn ? '2px solid var(--theme-accent)' : '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 12V8M8 12V4M12 12V6" stroke={heatmapOn ? "var(--theme-accent)" : "#6b7280"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Heatmap
                </button>
                <button
                  className="lmv-map-time-filter"
                  onClick={() => setTrafficOn((prev) => !prev)}
                  style={{ cursor: 'pointer', border: trafficOn ? '2px solid #f97316' : '1px solid var(--theme-border)', background: 'var(--theme-surface)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="4" r="2" fill={trafficOn ? "#dc2626" : "#6b7280"} />
                    <circle cx="8" cy="8" r="2" fill={trafficOn ? "#fbbf24" : "#9ca3af"} />
                    <circle cx="8" cy="12" r="2" fill={trafficOn ? "#4ade80" : "#d1d5db"} />
                  </svg>
                  Traffic
                </button>
              </div>

              <div className="lmv-nearby-overlay">
                <span className="lmv-nearby-label">Top nearby places</span>
                <div className="lmv-nearby-cards">
                  {nearbyPlaces.length === 0 ? (
                    <div className="lmv-nearby-empty">
                      <p>No places loaded yet.</p>
                      <p className="lmv-nearby-empty-hint">Run the backend and seed data to see rankings here.</p>
                    </div>
                  ) : (
                    nearbyPlaces.map((place) => (
                      <div
                        key={place.id || place.name}
                        className={`lmv-nearby-card ${place.featured ? 'featured' : 'regular'} ${selectedLocation?.id === place.id ? 'selected' : ''}`}
                        onClick={() => {
                          handleLocationSelect(place);
                          if (place.longitude != null && place.latitude != null) {
                            setFlyToLocation({ longitude: place.longitude, latitude: place.latitude, zoom: 16, _ts: Date.now() });
                          }
                        }}
                      >
                        <div className="lmv-nearby-card-header">
                          <span className={`lmv-nearby-score ${place.tier}`}>{place.score.toFixed(1)}</span>
                          <span className="lmv-nearby-distance">{getDistance(place)}</span>
                        </div>
                        <div className="lmv-nearby-card-info">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <h4>{place.name}</h4>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(
                                  `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`,
                                  '_blank'
                                );
                              }}
                              className="lmv-btn-directions-small"
                              title="Get Directions"
                            >
                              Directions
                            </button>
                          </div>
                          <p className="card-tags">{place.tags}</p>
                          <p className="card-desc">{place.desc}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Search Bar */}
            <form className="lmv-bottom-bar" onSubmit={handleSearchSubmit}>
              <div className="lmv-search-pill">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8.25" cy="8.25" r="4.5" stroke="#6b7280" strokeWidth="1.5" /><path d="M15.75 15.75L11.5 11.5" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" /></svg>
                <input
                  type="text"
                  placeholder="Search places or sensory tags"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={searchLoading}
                />
              </div>
              {searchResults !== null && !searchResults?.features?.length && !searchLoading && (
                <span style={{ position: 'absolute', bottom: '100%', left: 19, marginBottom: 6, fontSize: 13, color: '#ef4444' }}>
                  No results found for &quot;{searchQuery}&quot;
                </span>
              )}
              <div className="lmv-bottom-actions">
                <button type="button" className="lmv-btn-outline" onClick={handleCalmRoute}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8.67 3.33L14 8l-5.33 4.67" stroke="#0f1720" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Calm route
                </button>
                <button type="button" className="lmv-btn-primary" onClick={handlePersonalize}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M4 6l4-4 4 4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Personalize
                </button>
              </div>
            </form>
          </main>

          {selectedLocation && (
            <div className="lmv-detail-backdrop" onClick={() => { setSelectedLocation(null); setLocationDetail(null); }} />
          )}

          {/* Right Detail Panel */}
          <aside className="lmv-detail">
            <button
              className="lmv-detail-close"
              onClick={() => { setSelectedLocation(null); setLocationDetail(null); }}
              aria-label="Close detail panel"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Close
            </button>
            {/* Location Card */}
            <div className="lmv-detail-card">
              <div className="lmv-loc-photo">
                {(locationDetail?.imageUrl || locationDetail?.reviews?.find((r) => r.imageUrl)?.imageUrl) ? (
                  <img src={locationDetail.imageUrl || locationDetail.reviews.find((r) => r.imageUrl).imageUrl} alt={locName} />
                ) : (
                  <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg, var(--theme-tag-soft), var(--theme-tag-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--theme-text-muted)', fontSize: 13 }}>
                    {locName}
                  </div>
                )}
              </div>

              <div className="lmv-loc-header">
                <div className="lmv-loc-header-row">
                  <div className="lmv-loc-title">
                    <h2>{locName}</h2>
                    <p>{reviewCount > 0 ? `${reviewCount} reviews` : 'No reviews yet'}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="lmv-match-badge">
                    {matchPercent !== null ? `${matchPercent}% match` : (userProfile ? '—' : 'Set up profile')}
                  </span>
                  {selectedLocation?.id && (
                    <>
                      <button
                        type="button"
                        className={savedPlaceIds.has(selectedLocation.id) ? 'lmv-btn-saved' : 'lmv-btn-save'}
                        onClick={handleToggleSaved}
                        disabled={saveLoading}
                        aria-label={savedPlaceIds.has(selectedLocation.id) ? 'Remove from saved' : 'Save place'}
                      >
                        {savedPlaceIds.has(selectedLocation.id) ? (
                          <>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.333 14V3.333a1.333 1.333 0 00-1.333-1.333H4a1.333 1.333 0 00-1.333 1.333V14L8 11.333l5.333 2.667z" fill="currentColor" /></svg>
                            Saved
                          </>
                        ) : (
                          <>
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.333 14V3.333a1.333 1.333 0 00-1.333-1.333H4a1.333 1.333 0 00-1.333 1.333V14L8 11.333l5.333 2.667z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Save place
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="lmv-btn-directions"
                        onClick={() =>
                          window.open(
                            `https://www.google.com/maps/dir/?api=1&destination=${selectedLocation.latitude},${selectedLocation.longitude}`,
                            '_blank'
                          )
                        }
                      >
                        Directions
                      </button>
                      <button
                        type="button"
                        className={`lmv-btn-checkin ${checkedIn ? 'checked-in' : ''}`}
                        onClick={handleCheckIn}
                        disabled={checkInLoading || checkedIn}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          background: checkedIn ? 'var(--theme-green-soft, #d6f5e1)' : 'var(--theme-surface, #fff)',
                          color: checkedIn ? 'var(--theme-green-text, #05360d)' : 'var(--theme-text, #0f1720)',
                          border: `1px solid ${checkedIn ? 'var(--theme-green-text, #05360d)' : 'var(--theme-border, #e5e7eb)'}`,
                          padding: '6px 12px',
                          borderRadius: 8,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: (checkInLoading || checkedIn) ? 'default' : 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        {checkedIn ? (
                          <>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 7l2.5 2.5L10.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Checked in
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                              <path d="M7 1.75c-2.9 0-5.25 2.35-5.25 5.25 0 2.9 5.25 5.25 5.25 5.25s5.25-2.35 5.25-5.25c0-2.9-2.35-5.25-5.25-5.25z" stroke="currentColor" strokeWidth="1.2" />
                              <circle cx="7" cy="7" r="1.5" fill="currentColor" />
                            </svg>
                            I'm here
                          </>
                        )}
                      </button>
                    </>
                  )}

                  {/* Check-in error message (GPS / cooldown) */}
                  {checkInError && (
                    <div style={{
                      marginTop: 8,
                      padding: '8px 12px',
                      background: '#fff3cd',
                      border: '1px solid #f0c040',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#7a5700',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}>
                      <span>⏱</span>
                      {checkInError}
                    </div>
                  )}

                  {/* Quick rating prompt — slides in after check-in */}
                  {showQuickRating && (
                    <div style={{
                      marginTop: 10,
                      padding: '12px 14px',
                      background: 'var(--theme-surface, #fff)',
                      border: '1px solid var(--theme-border, #e5e7eb)',
                      borderRadius: 12,
                      boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                    }}>
                      {quickRatingSubmitted ? (
                        <div style={{ textAlign: 'center', fontSize: 13, color: '#2d7a4f', fontWeight: 600, padding: '4px 0' }}>
                          ✓ Thanks! Updating insights…
                        </div>
                      ) : (
                        <>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--theme-text-muted, #6b7280)', marginBottom: 10 }}>
                            Right now here — tap each:
                          </div>
                          {[
                            { dim: 'noise',    label: '🔊 Noise',    low: '🔇 Quiet',  high: '📢 Noisy'  },
                            { dim: 'lighting', label: '💡 Lighting', low: '🕯️ Dim',    high: '☀️ Bright' },
                            { dim: 'crowd',    label: '👥 Crowd',    low: '👤 Empty',  high: '🏙️ Busy'   },
                          ].map(({ dim, label, low, high }) => (
                            <div key={dim} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 11, color: 'var(--theme-text-muted, #6b7280)', width: 62, flexShrink: 0 }}>{label}</span>
                              {[{ val: 'low', text: low }, { val: 'high', text: high }].map(({ val, text }) => {
                                const selected = quickSelections[dim] === val;
                                return (
                                  <button
                                    key={val}
                                    type="button"
                                    onClick={() => handleQuickPick(dim, val)}
                                    style={{
                                      flex: 1,
                                      padding: '5px 4px',
                                      background: selected ? 'var(--theme-green-soft, #d6f5e1)' : 'var(--theme-bg, #f9fafb)',
                                      border: `1px solid ${selected ? 'var(--theme-green-text, #2d7a4f)' : 'var(--theme-border, #e5e7eb)'}`,
                                      borderRadius: 8,
                                      cursor: 'pointer',
                                      fontSize: 11,
                                      fontWeight: selected ? 700 : 500,
                                      color: selected ? 'var(--theme-green-text, #2d7a4f)' : 'var(--theme-text, #0f1720)',
                                      transition: 'all 0.15s',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {text}
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setShowQuickRating(false);
                              setQuickSelections({ noise: null, lighting: null, crowd: null });
                            }}
                            style={{
                              marginTop: 4,
                              width: '100%',
                              background: 'none',
                              border: 'none',
                              fontSize: 11,
                              color: 'var(--theme-text-muted, #9ca3af)',
                              cursor: 'pointer',
                              padding: '2px 0',
                            }}
                          >
                            Skip
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                </div>{/* end lmv-loc-header-row */}
                {(locationDetail?.address || locationHours?.available || locationWeather || nearbyConstruction) && (
                  <div className="lmv-location-meta">
                    {locationDetail?.address && (
                      <div className="lmv-meta-chip">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1C4.34 1 3 2.34 3 4c0 2.25 3 7 3 7s3-4.75 3-7c0-1.66-1.34-3-3-3zm0 4.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" fill="currentColor" /></svg>
                        <span>{locationDetail.address.split(',').slice(0, 2).join(',')}</span>
                      </div>
                    )}
                    {locationHours?.available && (
                      <div className={`lmv-meta-chip lmv-meta-chip--${locationHours.open_now ? 'open' : 'closed'}`}>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" /><path d="M6 3.5V6l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                        <span>{locationHours.open_now ? 'Open now' : 'Closed'}</span>
                      </div>
                    )}
                    {locationWeather && (
                      <div className="lmv-meta-chip">
                        <span>{weatherEmoji(locationWeather.code)}</span>
                        <span>{locationWeather.temp}°C</span>
                      </div>
                    )}
                    {nearbyConstruction && (
                      <div className="lmv-meta-chip lmv-meta-chip--construction">
                        <span>🚧</span>
                        <span>Construction nearby</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Stars */}
              {avgRating !== null && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <svg key={i} width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1.33L10.06 5.51L14.67 6.18L11.33 9.43L12.12 14.01L8 11.85L3.88 14.01L4.67 9.43L1.33 6.18L5.94 5.51L8 1.33Z"
                        fill={i <= Math.round(avgRating) ? '#F5A623' : 'none'}
                        stroke={i <= Math.round(avgRating) ? '#F5A623' : '#CBD5E1'}
                        strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ))}
                </div>
              )}

              {(() => {
                const reviews = locationDetail?.reviews ?? [];
                const botReviews = reviews.filter(r => r.user?.email === 'bot@sensemap.app');
                const communityReviews = reviews.filter(r => r.user?.email !== 'bot@sensemap.app');
                const allBot = reviews.length > 0 && communityReviews.length === 0;
                const mixed = communityReviews.length > 0 && botReviews.length > 0;

                if (reviewCount === 0) return (
                  <div style={{ padding: '12px', color: 'var(--theme-text-muted)', fontSize: 13, border: '1px solid var(--theme-border)', borderRadius: 8, marginTop: 8, background: 'var(--theme-tag-soft)' }}>
                    <strong style={{ display: 'block', marginBottom: 4, color: 'var(--theme-text)' }}>No visits yet — be the first to check in</strong>
                    Default category estimates shown below — not real community data.
                  </div>
                );
                if (allBot) return (
                  <div style={{ padding: '10px 12px', fontSize: 12, borderRadius: 8, marginTop: 8, background: '#ede9fe', color: '#5b21b6', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 10, background: '#5b21b6', color: '#fff', borderRadius: 4, padding: '1px 5px' }}>AI</span>
                    Scores estimated from Google reviews via Gemini — no community visits yet.
                  </div>
                );
                if (mixed) return (
                  <div style={{ padding: '10px 12px', fontSize: 12, borderRadius: 8, marginTop: 8, background: 'var(--theme-tag-soft)', color: 'var(--theme-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.2"/><path d="M6.5 4v3l1.5 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                    {communityReviews.length} community {communityReviews.length === 1 ? 'review' : 'reviews'} · AI-seeded data also included
                  </div>
                );
                return (
                  <div style={{ padding: '10px 12px', fontSize: 12, borderRadius: 8, marginTop: 8, background: '#d6f5e1', color: '#05360d', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M3 6.5l2.5 2.5 4.5-4.5" stroke="#05360d" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    {communityReviews.length} community {communityReviews.length === 1 ? 'review' : 'reviews'} — real visitor data
                  </div>
                );
              })()}

              <div className="lmv-stat-boxes" style={{ opacity: reviewCount === 0 ? 0.4 : 1 }}>
                <div className="lmv-stat-box">
                  <div className="box-label">Comfort</div>
                  <div className="box-value">{comfortScore}</div>
                </div>
                <div className="lmv-stat-box">
                  <div className="box-label">Noise</div>
                  <div className="box-value small">{noiseLevel}</div>
                </div>
                <div className="lmv-stat-box">
                  <div className="box-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    Best time
                    {aiInsights?.bestTime && (
                      <span style={{ fontSize: 10, background: '#ede9fe', color: '#5b21b6', borderRadius: 4, padding: '1px 4px', fontWeight: 600 }}>AI</span>
                    )}
                  </div>
                  <div className="box-value small">{bestTimeText}</div>
                </div>
              </div>

              <div className="lmv-loc-tags">
                {aiInsights?.tags?.length > 0 && (
                  <span className="lmv-loc-tag" style={{ background: '#ede9fe', color: '#5b21b6', fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="4" stroke="#5b21b6" strokeWidth="1.2"/><path d="M5 3v2.5l1.5 1" stroke="#5b21b6" strokeWidth="1" strokeLinecap="round"/></svg>
                    AI tags
                  </span>
                )}
                {locationTags.map((tag) => (
                  <span key={tag} className="lmv-loc-tag">{tag}</span>
                ))}
              </div>

              {/* Rating tags */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                <span className="lmv-loc-tag" style={{ background: '#d6f5e1', color: '#05360d' }}>
                  {Math.round((sensory.comfortScore ?? sensory.comfort_score ?? 0) / 5 * 100)}% would revisit
                </span>
                {(sensory.noiseScore ?? sensory.noise_score ?? 5) < 2 && (
                  <span className="lmv-loc-tag" style={{ background: '#d6f5e1', color: '#05360d' }}>Low-noise favorite</span>
                )}
                {(sensory.crowdScore ?? sensory.crowd_score ?? 5) < 2 && (
                  <span className="lmv-loc-tag" style={{ background: '#d6f5e1', color: '#05360d' }}>Low-crowd spot</span>
                )}
                {aiInsights?.bestTime && (
                  <span className="lmv-loc-tag" style={{ background: '#ede9fe', color: '#5b21b6' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, marginRight: 2 }}>AI</span>
                    Best: {aiInsights.bestTime.split(' ').slice(0, 3).join(' ')}
                  </span>
                )}
              </div>

              {/* Write a Review button — only shown when a location is selected */}
              {selectedLocation?.id && (
                <button
                  type="button"
                  onClick={() => setShowReviewForm(true)}
                  style={{
                    marginTop: 14,
                    width: '100%',
                    padding: '9px 0',
                    borderRadius: 8,
                    border: '1px solid var(--theme-accent)',
                    background: 'transparent',
                    color: 'var(--theme-accent)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Write a Review
                </button>
              )}
            </div>

            {/* Noise through the day */}
            {reviewCount > 0 && (
              <div className="lmv-detail-card">
                <div>
                  <h3 className="lmv-section-title">Noise through the day</h3>
                  <p className="lmv-section-desc">Estimated trend based on sensory scores — not real-time data.</p>
                </div>
                <div style={{ width: '100%', height: 120, minWidth: 0 }}>
                  <ResponsiveContainer width="99%" height={120} debounce={50}>
                    <LineChart data={noiseChartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#edf3f8" />
                      <XAxis dataKey="time" tick={{ fontSize: 11, fill: 'var(--theme-text-muted)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--theme-text-muted)' }} domain={[0, 5]} />
                      <Tooltip />
                      <Line type="monotone" dataKey="noise" stroke="#ffb3a3" strokeWidth={2} dot={false} name="Noise" />
                      <Line type="monotone" dataKey="calm" stroke="#6ad6c8" strokeWidth={2} dot={false} name="Calm" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* AI Insight */}
            <div className="lmv-detail-card">
              <div>
                <h3 className="lmv-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  AI insight
                  <span style={{ fontSize: 11, background: '#ede9fe', color: '#5b21b6', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>Gemini AI</span>
                </h3>
                <p className="lmv-section-desc">Generated by AI from community reviews. Not a substitute for personal judgement.</p>
              </div>

              {reviewCount === 0 ? (
                <p style={{ color: 'var(--theme-text-muted)', fontSize: 13 }}>
                  AI insights will appear once this place has been visited.
                </p>
              ) : aiLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <SkeletonBlock height={20} />
                  <SkeletonBlock height={8} />
                  <SkeletonBlock height={48} />
                  <SkeletonBlock height={48} />
                  <SkeletonBlock height={48} />
                </div>
              ) : aiInsights ? (
                <>
                  <div className="lmv-ai-header">
                    <span className="lmv-ai-badge">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.25" stroke="#0f1720" strokeWidth="1.2" /><path d="M5.25 7h3.5M7 5.25v3.5" stroke="#0f1720" strokeWidth="1.2" strokeLinecap="round" /></svg>
                      AI confidence
                    </span>
                    <span className="lmv-ai-percent">{aiInsights.confidence}%</span>
                  </div>

                  <div className="lmv-ai-bar">
                    <div className="lmv-ai-bar-fill" style={{ width: `${aiInsights.confidence}%` }} />
                  </div>

                  <div className="lmv-ai-insights">
                    <div className="lmv-ai-item">
                      <div className="lmv-ai-item-icon">
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M2.5 7.5a5 5 0 0110 0" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" /><path d="M5 10.5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      </div>
                      <div className="lmv-ai-item-text">
                        <h5>Noise</h5>
                        <p>{aiInsights.noise?.summary ?? '—'}</p>
                      </div>
                    </div>
                    <div className="lmv-ai-item">
                      <div className="lmv-ai-item-icon">
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="4" r="2" stroke="#8b5cf6" strokeWidth="1.3" /><path d="M7.5 6v5M5.5 8.5l2 2.5 2-2.5" stroke="#8b5cf6" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                      <div className="lmv-ai-item-text">
                        <h5>Lighting</h5>
                        <p>{aiInsights.lighting?.summary ?? '—'}</p>
                      </div>
                    </div>
                    <div className="lmv-ai-item">
                      <div className="lmv-ai-item-icon">
                        <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><circle cx="7.5" cy="7.5" r="5" stroke="#6b7280" strokeWidth="1.3" /><path d="M7.5 4v3.5l2.5 1.5" stroke="#6b7280" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </div>
                      <div className="lmv-ai-item-text">
                        <h5>Best time</h5>
                        <p>{aiInsights.bestTime ?? '—'}</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p style={{ color: 'var(--theme-text-muted)', fontSize: 13 }}>Select a location to see AI insights.</p>
              )}
            </div>

            {/* Recent Reviews */}
            {locationDetail?.reviews?.length > 0 && (
              <div className="lmv-detail-card">
                <h3 className="lmv-section-title">Recent reviews</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
                  {locationDetail.reviews.slice(0, 5).map((review) => {
                    const isBot = review.user?.email === 'bot@sensemap.app';
                    const author = isBot ? 'SenseMap Bot' : (review.user?.username || 'Anonymous');
                    const date = new Date(review.visitedAt || review.createdAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
                    return (
                      <div key={review.id} style={{ borderBottom: '1px solid var(--theme-border)', paddingBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>{author}</span>
                          {isBot && (
                            <span style={{ fontSize: 10, fontWeight: 700, background: '#ede9fe', color: '#5b21b6', borderRadius: 4, padding: '1px 5px' }}>AI</span>
                          )}
                          <span style={{ fontSize: 11, color: 'var(--theme-text-muted)', marginLeft: 'auto' }}>{date}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, background: 'var(--theme-tag-soft)', borderRadius: 4, padding: '2px 6px', color: 'var(--theme-text-muted)' }}>🔇 {review.noiseLevel}/10</span>
                          <span style={{ fontSize: 11, background: 'var(--theme-tag-soft)', borderRadius: 4, padding: '2px 6px', color: 'var(--theme-text-muted)' }}>💡 {review.lightingLevel}/10</span>
                          <span style={{ fontSize: 11, background: 'var(--theme-tag-soft)', borderRadius: 4, padding: '2px 6px', color: 'var(--theme-text-muted)' }}>👥 {review.crowdLevel}/10</span>
                        </div>
                        {review.bodyText && (
                          <p style={{ fontSize: 13, color: 'var(--theme-text)', lineHeight: 1.5, margin: 0 }}>{review.bodyText}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sensory Profile (Radar) */}
            <div className="lmv-detail-card">
              <div>
                <h3 className="lmv-section-title">Sensory profile</h3>
                <p className="lmv-section-desc">A simplified radar view for this location.</p>
              </div>

              <div className="lmv-radar-container">
                <div style={{ width: 250, height: 200, minWidth: 0 }}>
                  <ResponsiveContainer width={250} height={200} debounce={50}>
                    <RadarChart data={radarData} outerRadius={70}>
                      <PolarGrid stroke="#e5e7eb" />
                      <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: 'var(--theme-text-muted)' }} />
                      <PolarRadiusAxis angle={90} domain={[0, 10]} tick={{ fontSize: 9, fill: '#94a3b8' }} />
                      <Radar dataKey="value" stroke="var(--theme-accent)" fill="var(--theme-accent)" fillOpacity={0.25} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                <div className="lmv-profile-grid">
                  <div className="lmv-profile-stat"><span className="pstat-label">Noise</span><span className="pstat-value">{((sensory.noiseScore ?? sensory.noise_score ?? 0) * 2).toFixed(0)}</span></div>
                  <div className="lmv-profile-stat"><span className="pstat-label">Lighting</span><span className="pstat-value">{((sensory.lightingScore ?? sensory.lighting_score ?? 0) * 2).toFixed(0)}</span></div>
                  <div className="lmv-profile-stat"><span className="pstat-label">Crowds</span><span className="pstat-value">{((sensory.crowdScore ?? sensory.crowd_score ?? 0) * 2).toFixed(0)}</span></div>
                  <div className="lmv-profile-stat"><span className="pstat-label">Comfort</span><span className="pstat-value">{((sensory.comfortScore ?? sensory.comfort_score ?? 0) * 2).toFixed(0)}</span></div>
                </div>
              </div>
            </div>

            {/* Comfort Score Breakdown */}
            <div className="lmv-detail-card">
              <div>
                <h3 className="lmv-section-title">Comfort score</h3>
                <p className="lmv-section-desc">How the score is calculated.</p>
              </div>

              <div className="lmv-comfort-header">
                <div className="lmv-comfort-score">
                  <div className="cscore-label">Sensory Comfort Score</div>
                  <div className="cscore-value">{comfortScore} / 5</div>
                </div>
                <span className="lmv-tag green">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.25 7A5.25 5.25 0 111.75 7a5.25 5.25 0 0110.5 0z" stroke="#05360d" strokeWidth="1.2" /><path d="M4.5 7l2 2 3.5-3.5" stroke="#05360d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {parseInt(breakdown.noise) >= parseInt(breakdown.crowd) && parseInt(breakdown.noise) >= parseInt(breakdown.lighting) ? 'Noise matters most' :
                    parseInt(breakdown.crowd) >= parseInt(breakdown.lighting) ? 'Crowds matter most' : 'Lighting matters most'}
                </span>
              </div>

              <div className="lmv-score-bars">
                <div className="lmv-score-row">
                  <span className="sr-label">Noise</span>
                  <div className="sr-bar"><div className="sr-fill blue" style={{ width: `${breakdown.noise}%` }} /></div>
                  <span className="sr-percent">{breakdown.noise}%</span>
                </div>
                <div className="lmv-score-row">
                  <span className="sr-label">Lighting</span>
                  <div className="sr-bar"><div className="sr-fill teal" style={{ width: `${breakdown.lighting}%` }} /></div>
                  <span className="sr-percent">{breakdown.lighting}%</span>
                </div>
                <div className="lmv-score-row">
                  <span className="sr-label">Crowds</span>
                  <div className="sr-bar"><div className="sr-fill yellow" style={{ width: `${breakdown.crowd}%` }} /></div>
                  <span className="sr-percent">{breakdown.crowd}%</span>
                </div>
                <div className="lmv-score-row">
                  <span className="sr-label">Comfort</span>
                  <div className="sr-bar"><div className="sr-fill purple" style={{ width: `${breakdown.comfort}%` }} /></div>
                  <span className="sr-percent">{breakdown.comfort}%</span>
                </div>
              </div>
            </div>

            {/* Why it fits you */}
            <div className="lmv-detail-card">
              <div>
                <h3 className="lmv-section-title">Why it fits you</h3>
                <p className="lmv-section-desc">A short recommendation and a soft alert.</p>
              </div>

              <div className="lmv-match-card">
                <div className="lmv-match-card-header">
                  <h4>Match score</h4>
                  <span className="lmv-match-badge">{matchPercent !== null ? `${matchPercent}%` : '—'}</span>
                </div>
                <div className="lmv-match-bar">
                  <div className="lmv-match-bar-fill" style={{ width: `${matchPercent ?? 0}%` }} />
                </div>
                <div className="lmv-match-checks">
                  {matchChecks.length > 0 ? matchChecks.map((check) => (
                    <div key={check} className="lmv-match-check">
                      <span className="lmv-check-icon">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 7l2.5 2.5L10.5 5" stroke="#05360d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                      {check}
                    </div>
                  )) : (
                    <p style={{ color: 'var(--theme-text-muted)', fontSize: 13, margin: 0 }}>
                      {userProfile ? 'Select a location to see match details.' : 'Set up your sensory profile to see matches.'}
                    </p>
                  )}
                </div>
              </div>

              {triggers.length > 0 && (
                <div className="lmv-trigger-card">
                  <h4>Possible triggers later today</h4>
                  <div className="lmv-trigger-chips">
                    {triggers.map((t) => (
                      <span key={t} className="lmv-trigger-chip">
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.75v3.5L9.33 7" stroke="#0f1720" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="7" cy="7" r="5.25" stroke="#0f1720" strokeWidth="1.2" /></svg>
                        {t}
                      </span>
                    ))}
                  </div>
                  {triggerTip && <p className="lmv-trigger-tip">Tip: {triggerTip}</p>}
                </div>
              )}
            </div>

            {/* Similar Places */}
            {similarLocations.length > 0 && (
              <div className="lmv-detail-card" style={{ marginBottom: 32 }}>
                <div>
                  <h3 className="lmv-section-title">Similar places</h3>
                  <p className="lmv-section-desc">Locations with a matching sensory profile.</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {similarLocations.map((loc) => (
                    <div
                      key={loc.id}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--theme-tag-soft)', borderRadius: 8, cursor: 'pointer' }}
                      onClick={() => {
                        handleLocationSelect(loc);
                        if (loc.longitude != null && loc.latitude != null) {
                          setFlyToLocation({ longitude: loc.longitude, latitude: loc.latitude, zoom: 16, _ts: Date.now() });
                        }
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>{loc.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--theme-text-muted)', marginTop: 2 }}>{loc.category || '—'} · {loc.similarity}% similar</div>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--theme-accent)', flexShrink: 0, marginLeft: 8 }}>
                        {(loc.sensoryScores?.comfortScore ?? 0).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </>
      )}

      {showLogoutModal && (
        <LogoutConfirmation 
          onCancel={() => setShowLogoutModal(false)} 
          onLogout={onLogout} 
        />
      )}
    </div>
  );
}

export default LoggedInMapView;