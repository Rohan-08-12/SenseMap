import { useState, useEffect, useRef } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTheme } from '../theme/ThemeContext.jsx';
import { scoreToLabel } from '../utils.js';
import MapView from './MapView';
import { getRankings, getLocationHeatmap, getLocationById, getLocationHours, searchLocations, checkNearbyConstruction } from '../services/api';
import './NonLoginMapView.css';

const QUICK_FILTERS = [
  { label: 'Quiet now', filter: 'quiet-now' },
  { label: 'Low crowds', filter: 'low-crowds' },
  { label: 'Soft lighting', filter: 'soft-lighting' },
  { label: 'Outdoor spaces', filter: 'outdoor' },
  { label: 'Before noon', filter: 'before-noon' },
  { label: 'Nearby', filter: 'nearby' },
];

const PLACE_FILTERS = [
  { emoji: '☕', label: 'Cafes', filter: 'cafes' },
  { emoji: '🌿', label: 'Parks', filter: 'parks' },
  { emoji: '📚', label: 'Libraries', filter: 'libraries' },
  { emoji: '🍽️', label: 'Restaurants', filter: 'restaurants' },
  { emoji: '🏋️', label: 'Fitness', filter: 'fitness' },
];

const CATEGORY_CHIPS = [
  { emoji: '🤫', title: 'Quiet', desc: 'Low-noise spots', filter: 'quiet-now' },
  { emoji: '💡', title: 'Soft light', desc: 'Gentler lighting', filter: 'soft-lighting' },
  { emoji: '🌳', title: 'Outdoor', desc: 'Open green areas', filter: 'outdoor' },
  { emoji: '🔍', title: 'Explore all', desc: 'See every place', filter: null },
];


/**
 * NonLoginMapView Component
 * The main public-facing map interface of SenseMap.
 * It renders the Deck.gl map, fetches the location heatmap, displays top-ranked
 * sensory-friendly places, and allows users to explore locations without an account.
 */
function weatherEmoji(code) {
  if (code === 0) return '☀️';
  if (code <= 3) return '🌤️';
  if (code <= 48) return '🌫️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  if (code <= 82) return '🌦️';
  return '⛈️';
}

function NonLoginMapView({ onBackToHome, initialSearchQuery, initialFilter, onLogin }) {
  const loginWithRedirect = () => onLogin();
  const [activeFilter, setActiveFilter] = useState(initialFilter ?? null);
  const [heatmapOn, setHeatmapOn] = useState(true);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery ?? '');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [locationDetail, setLocationDetail] = useState(null);
  const [avgRating, setAvgRating] = useState(null);
  const [locationHours, setLocationHours] = useState(null);
  const [locationWeather, setLocationWeather] = useState(null);
  const [nearbyConstruction, setNearbyConstruction] = useState(false);
  const [trafficOn, setTrafficOn] = useState(false);
  const [searchNoResults, setSearchNoResults] = useState(false);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [showSigninDetail, setShowSigninDetail] = useState(false);

  const toggleNavCollapse = () => setIsNavCollapsed((prev) => !prev);
  const toggleSigninDetail = () => setShowSigninDetail((prev) => !prev);
  const signinPopoverRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const { theme, setTheme } = useTheme();
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!showSigninDetail) return;
    const handleClickOutside = (e) => {
      if (signinPopoverRef.current && !signinPopoverRef.current.contains(e.target)) {
        setShowSigninDetail(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSigninDetail]);

  // --- Mount: fetch heatmap, rankings, geolocation ---
  useEffect(() => {
    getLocationHeatmap()
      .then((res) => {
        const data = res.data;
        if (Array.isArray(data)) {
          setHeatmapData(data);
          const calmCount = data.filter((l) => (l.comfortScore ?? 0) > 3.5).length;
          const avgNoise = data.length > 0 ? data.reduce((a, b) => a + (b.noiseScore ?? 0), 0) / data.length : 0;
          const avgComfort = data.length > 0 ? data.reduce((a, b) => a + (b.comfortScore ?? 0), 0) / data.length : 0;
          const hour = new Date().getHours();
          const bestWindow = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
          setSnapshot({ calmCount, noiseTrend: scoreToLabel(avgNoise), avgComfort, bestWindow });
        }
      })
      .catch(() => { });

    getRankings()
      .then((res) => {
        const data = res.data;
        if (Array.isArray(data) && data.length > 0) {
          setRankings(
            data.slice(0, 5).map((loc) => ({
              id: loc.locationId,
              name: loc.name,
              category: loc.category,
              address: loc.address,
              latitude: loc.latitude,
              longitude: loc.longitude,
              tags: (() => {
                const t = [];
                if ((loc.noiseScore ?? 5) < 2) t.push('Very quiet');
                if ((loc.lightingScore ?? 5) < 3.5) t.push('Soft lighting');
                if ((loc.crowdScore ?? 5) < 2) t.push('Low crowds');
                if ((loc.comfortScore ?? 0) > 3.5) t.push('Highly comfortable');
                return t.length > 0 ? t.join(' • ') : (loc.category || 'Sensory-friendly');
              })(),
              score: loc.comfortScore ?? 0,
              tier: (loc.comfortScore ?? 0) >= 4 ? 'high' : (loc.comfortScore ?? 0) >= 2.5 ? 'medium' : 'low',
              noise_score: loc.noiseScore,
              lighting_score: loc.lightingScore,
              crowd_score: loc.crowdScore,
              comfort_score: loc.comfortScore,
            }))
          );
        }
      })
      .catch(() => { });

  }, []);

  // --- On mount: run search if opened from launch with a query ---
  useEffect(() => {
    if (!initialSearchQuery?.trim()) return;
    setSearchLoading(true);
    searchLocations(initialSearchQuery.trim())
      .then((res) => {
        setSearchResults(res.data);
        if (!res.data?.features?.length) {
          setSearchNoResults(true);
          setTimeout(() => setSearchNoResults(false), 3000);
        }
      })
      .catch(() => {
        setSearchResults({ features: [] });
        setSearchNoResults(true);
        setTimeout(() => setSearchNoResults(false), 3000);
      })
      .finally(() => setSearchLoading(false));
  }, [initialSearchQuery]);

  // --- When selected location changes: fetch detail, hours, weather ---
  useEffect(() => {
    if (!selectedLocation) return;
    setLocationDetail(null);
    setAvgRating(null);
    setLocationHours(null);
    setLocationWeather(null);
    setNearbyConstruction(false);

    const locId = selectedLocation.id;
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

    getLocationHours(locId)
      .then((res) => setLocationHours(res.data))
      .catch(() => { });

    const lat = selectedLocation.latitude;
    const lng = selectedLocation.longitude;
    if (lat != null && lng != null) {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&temperature_unit=celsius&forecast_days=1`)
        .then((r) => r.json())
        .then((data) => {
          if (data.current) {
            setLocationWeather({ temp: Math.round(data.current.temperature_2m), code: data.current.weather_code });
          }
        })
        .catch(() => { });

      checkNearbyConstruction(lat, lng)
        .then((res) => { setNearbyConstruction(!!res.data?.nearby); })
        .catch(() => {});
    }
  }, [selectedLocation]);

  const handleFilterClick = (filter) => {
    setActiveFilter((prev) => (prev === filter ? null : filter));
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setSearchNoResults(false);
      return;
    }
    setSearchLoading(true);
    setSearchNoResults(false);
    try {
      const res = await searchLocations(searchQuery.trim());
      setSearchResults(res.data);
      if (!res.data?.features?.length) {
        setSearchNoResults(true);
        setTimeout(() => setSearchNoResults(false), 3000);
      }
    } catch {
      setSearchResults({ features: [] });
      setSearchNoResults(true);
      setTimeout(() => setSearchNoResults(false), 3000);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleCategoryClick = (f) => {
    setActiveFilter((prev) => (prev === f ? null : f));
  };

  const handleLocationSelect = (location) => {
    setSelectedLocation(location);
  };

  const handleSignIn = () => {
    loginWithRedirect();
  };

  // --- Derived values from real API data ---
  // Prefer backend-computed displayScores (blends community + AI-estimated); fall back to raw sensoryScores
  const _ds = locationDetail?.displayScores;
  const sensory = _ds
    ? { noiseScore: _ds.noise, lightingScore: _ds.lighting, crowdScore: _ds.crowd, comfortScore: _ds.comfort ?? (_ds.noise + _ds.lighting + _ds.crowd) / 3 }
    : (locationDetail?.sensoryScores || selectedLocation || {});
  const dataSource = _ds?.source ?? 'category';
  const locationName = selectedLocation?.name || 'Select a location';
  const reviewCount = locationDetail?.sensoryScores?.reviewCount ?? locationDetail?.reviews?.length ?? 0;

  const noiseScore = sensory.noiseScore ?? sensory.noise_score ?? 2.5;
  const lightingScore = sensory.lightingScore ?? sensory.lighting_score ?? 2.5;
  const crowdScore = sensory.crowdScore ?? sensory.crowd_score ?? 2.5;
  const comfortScore = sensory.comfortScore ?? sensory.comfort_score ?? 2.5;
  const overallScore = comfortScore.toFixed(1);

  const starCount = avgRating !== null ? Math.round(avgRating) : 0;

  // Rating tags
  const ratingTags = (() => {
    if (reviewCount === 0 && dataSource === 'category') return ['No visits yet — be the first'];
    if (reviewCount === 0 && dataSource === 'estimated') return ['AI-estimated profile'];
    const tags = [];
    const revisit = Math.round(comfortScore / 5 * 100);
    tags.push(`${revisit}% would revisit`);
    if (noiseScore < 2) tags.push('Low-noise favorite');
    if (crowdScore < 2) tags.push('Low-crowd spot');
    return tags;
  })();

  // Map filter conversion for MapView
  const mapFilter = (() => {
    if (!activeFilter) return null;
    if (activeFilter === 'nearby') return null;
    return activeFilter;
  })();

  const zoomTransition = prefersReducedMotion
    ? { duration: 0.1 }
    : { duration: 0.5, ease: [0.22, 0.61, 0.36, 1] };
  const fadeTransition = prefersReducedMotion
    ? { duration: 0.1 }
    : { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] };

  const mapWrapperVariants = {
    closed: { opacity: 0, scale: 0.96 },
    open: {
      opacity: 1,
      scale: 1,
      transition: {
        opacity: fadeTransition,
        scale: zoomTransition,
      },
    },
  };

  const handleCloseClick = () => {
    if (!onBackToHome) return;
    setIsClosing(true);
  };

  return (
    <motion.div
      className="nlm"
      initial="closed"
      animate={isClosing ? 'closed' : 'open'}
      variants={mapWrapperVariants}
      transition={
        isClosing
          ? prefersReducedMotion
            ? { duration: 0.1 }
            : { opacity: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }, scale: { duration: 0.4, ease: [0.22, 0.61, 0.36, 1] } }
          : undefined
      }
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'var(--theme-bg)',
        transformOrigin: 'center center',
      }}
      onAnimationComplete={() => {
        if (isClosing && onBackToHome) {
          onBackToHome();
        }
      }}
    >
      {/* Background map */}
      <div className="nlm-map-container">
        <MapView
          onLocationSelect={handleLocationSelect}
          filter={mapFilter}
          searchResultsGeoJSON={searchResults}
          heatmapEnabled={heatmapOn}
          heatmapData={heatmapData}
          trafficEnabled={trafficOn}
        />
      </div>

      <div className="nlm-heatmap-toggle" style={{ zIndex: 9999 }}>
        <button
          className="nlm-theme-btn nlm-theme-btn--text"
          onClick={() => setHeatmapOn((prev) => !prev)}
          style={{ cursor: 'pointer', border: heatmapOn ? '2px solid var(--theme-accent)' : '1px solid var(--theme-border)', background: 'var(--theme-surface)', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 500 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 12V8M8 12V4M12 12V6" stroke={heatmapOn ? "var(--theme-accent)" : "#6b7280"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Heatmap
        </button>
        <button
          className="nlm-theme-btn nlm-theme-btn--text"
          onClick={() => setTrafficOn((prev) => !prev)}
          style={{ cursor: 'pointer', border: trafficOn ? '2px solid #f97316' : '1px solid var(--theme-border)', background: 'var(--theme-surface)', padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 500 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="4" r="2" fill={trafficOn ? "#dc2626" : "#6b7280"} />
            <circle cx="8" cy="8" r="2" fill={trafficOn ? "#fbbf24" : "#9ca3af"} />
            <circle cx="8" cy="12" r="2" fill={trafficOn ? "#4ade80" : "#d1d5db"} />
          </svg>
          Traffic
        </button>
      </div>

      {/* Left Sidebar */}
      <aside
        className={`nlm-sidebar-left${isNavCollapsed ? ' nlm-sidebar-left--collapsed' : ''}`}
      >
        {/* Drag handle — visible only in mobile bottom-sheet mode via CSS */}
        <div className="nlm-sidebar-drag-handle" aria-hidden="true" />
        {/* Fixed header / navigation bar */}
        <div className="nlm-sidebar-left-header">
          <div className="nlm-logo-row">
            <div className="nlm-logo-group">
              <div className="nlm-logo-icon">
                <img src="/favicon.png" alt="" />
              </div>
              <div className="nlm-logo-text">
                <h1>SenseMap</h1>
              </div>
            </div>
          </div>
          <div className="nlm-theme-switcher" role="group" aria-label="Theme">
            {['nature', 'calm'].map((t) => (
              <button
                key={t}
                type="button"
                className={`nlm-theme-btn nlm-theme-btn--text ${theme === t ? 'active' : ''}`}
                onClick={() => setTheme(t)}
                aria-pressed={theme === t}
                aria-label={`${t.charAt(0).toUpperCase() + t.slice(1)} theme`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="nlm-nav-collapse-btn"
            onClick={toggleNavCollapse}
            aria-label={isNavCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!isNavCollapsed}
          >
            <svg
              className="nlm-nav-collapse-arrow"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                d="M12.5 4L7.5 10L12.5 16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="nlm-nav-collapse-hint" aria-hidden="true">Filters & places</span>
        </div>
        {/* Scrollable body — scroll bar lives here, under the nav */}
        <div className="nlm-sidebar-left-body">
          {/* Hero card */}
          <div className="nlm-hero-card">
            <div className="nlm-calm-badge">
              ✨ Calm mode on
            </div>
            <h2>Find a place that feels better right now.</h2>
            <p className="nlm-hero-desc">
              {snapshot
                ? `${snapshot.calmCount} calm places nearby • Noise trend: ${snapshot.noiseTrend} • Best: ${snapshot.bestWindow}`
                : 'Only the most important details are shown: comfort, likely triggers, and best times to go.'}
            </p>
          </div>

          {/* Quick Filters */}
          <div className="nlm-filters">
            <h3>Quick filters</h3>
            <div className="nlm-filter-chips">
              {QUICK_FILTERS.map((f) => (
                <button
                  key={f.filter}
                  className={`nlm-filter-chip${activeFilter === f.filter ? ' active' : ''}`}
                  onClick={() => handleFilterClick(f.filter)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <h3 style={{ marginTop: 12 }}>Place type</h3>
            <div className="nlm-filter-chips">
              {PLACE_FILTERS.map((f) => (
                <button
                  key={f.filter}
                  className={`nlm-filter-chip nlm-filter-chip--place${activeFilter === f.filter ? ' active' : ''}`}
                  onClick={() => handleFilterClick(f.filter)}
                >
                  <span aria-hidden>{f.emoji}</span>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search results or top ranked */}
          {searchResults ? (
            <div className="nlm-ranked">
              <div className="nlm-ranked-header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3>
                    {searchLoading
                      ? 'Searching…'
                      : searchResults.features?.length > 0
                        ? `${searchResults.features.length} result${searchResults.features.length !== 1 ? 's' : ''}`
                        : 'No results found'}
                  </h3>
                  <button
                    className="nlm-btn-directions-small"
                    onClick={() => { setSearchResults(null); setSearchQuery(''); setSearchNoResults(false); }}
                  >
                    Clear
                  </button>
                </div>
                <p>Showing places matching your search.</p>
              </div>
              <div className="nlm-ranked-list">
                {searchLoading ? (
                  <>
                    <div className="animate-pulse" style={{ height: 56, background: 'var(--theme-border)', borderRadius: 8, marginBottom: 8 }} />
                    <div className="animate-pulse" style={{ height: 56, background: 'var(--theme-border)', borderRadius: 8, marginBottom: 8 }} />
                    <div className="animate-pulse" style={{ height: 56, background: 'var(--theme-border)', borderRadius: 8 }} />
                  </>
                ) : searchResults.features?.length > 0 ? searchResults.features.map((feat) => {
                  const p = feat.properties;
                  const lat = feat.geometry.coordinates[1];
                  const lng = feat.geometry.coordinates[0];
                  const score = p.comfortScore ?? 0;
                  const tier = score >= 4 ? 'high' : score >= 2.5 ? 'medium' : 'low';
                  const place = { id: p.id, name: p.name, category: p.category, latitude: lat, longitude: lng, score, tier, noise_score: p.noiseScore, lighting_score: p.lightingScore, crowd_score: p.crowdScore, comfort_score: p.comfortScore };
                  return (
                    <div
                      key={p.id ?? p.name}
                      className="nlm-ranked-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLocationSelect(place)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLocationSelect(place)}
                    >
                      <div className="nlm-ranked-info">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <h4>{p.name}</h4>
                          <button
                            onClick={(e) => { e.stopPropagation(); window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank'); }}
                            className="nlm-btn-directions-small"
                            title="Get Directions"
                          >
                            Directions
                          </button>
                        </div>
                        <p>{p.category || 'Place'}</p>
                      </div>
                      <div className={`nlm-ranked-score ${tier}`}>
                        {score > 0 ? score.toFixed(1) : '—'}
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--theme-text-muted)', fontSize: 13 }}>
                    Try a different search term.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="nlm-ranked">
              <div className="nlm-ranked-header">
                <h3>Top ranked sensory-friendly places</h3>
                <p>Best options nearby with simple summaries.</p>
              </div>
              <div className="nlm-ranked-list">
                {rankings.length > 0 ? rankings.map((place) => (
                  <div
                    key={place.id ?? place.name}
                    className="nlm-ranked-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleLocationSelect(place)}
                    onKeyDown={(e) => e.key === 'Enter' && handleLocationSelect(place)}
                  >
                    <div className="nlm-ranked-info">
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
                          className="nlm-btn-directions-small"
                          title="Get Directions"
                        >
                          Directions
                        </button>
                      </div>
                      <p>{place.tags}</p>
                    </div>
                    <div className={`nlm-ranked-score ${place.tier}`}>
                      {(place.score || 0).toFixed(1)}
                    </div>
                  </div>
                )) : (
                  <div style={{ padding: 16, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                    <div className="animate-pulse" style={{ height: 48, background: '#e5e7eb', borderRadius: 6, marginBottom: 8 }} />
                    <div className="animate-pulse" style={{ height: 48, background: '#e5e7eb', borderRadius: 6, marginBottom: 8 }} />
                    <div className="animate-pulse" style={{ height: 48, background: '#e5e7eb', borderRadius: 6 }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Right Sidebar */}
      <aside className="nlm-sidebar-right">
        {/* Ratings Card */}
        <div className="nlm-ratings-card">
          <AnimatePresence mode="wait">
            {!selectedLocation ? (
              <motion.div
                key="no-selection"
                className="nlm-ratings-no-selection"
                role="status"
                aria-live="polite"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={prefersReducedMotion ? { duration: 0.1 } : { duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="nlm-ratings-no-selection-icon" aria-hidden>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
                  </svg>
                </div>
                <span className="nlm-ratings-no-selection-label">Ratings</span>
                <p className="nlm-ratings-no-selection-title">No location selected</p>
                <p className="nlm-ratings-no-selection-hint">Choose a place on the map or from the list to view sensory ratings and reviews.</p>
              </motion.div>
            ) : (
              <motion.div
                key={selectedLocation.id || 'selection'}
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={prefersReducedMotion ? { duration: 0.1 } : { duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="nlm-ratings-header">
                  <div className="nlm-ratings-title">
                    <h2>Ratings</h2>
                    <p>{locationName}</p>
                  </div>
                  <div className="nlm-score-badge">
                    <span className="score-value">{dataSource === 'category' ? '—' : overallScore}</span>
                    <span className="score-label">{dataSource === 'community' ? `${reviewCount} reviews` : dataSource === 'estimated' ? 'AI estimate' : 'No data'}</span>
                  </div>
                </div>

                {/* Address + hours + weather info row */}
                <div className="nlm-location-meta">
                  {locationDetail?.address && (
                    <div className="nlm-meta-chip">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                      <span>{locationDetail.address.split(',').slice(0, 2).join(',')}</span>
                    </div>
                  )}
                  {locationHours?.available && (
                    <div className={`nlm-meta-chip nlm-meta-chip--${locationHours.open_now ? 'open' : 'closed'}`}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span>{locationHours.open_now ? 'Open now' : 'Closed'}</span>
                    </div>
                  )}
                  {locationWeather && (
                    <div className="nlm-meta-chip">
                      <span aria-hidden>{weatherEmoji(locationWeather.code)}</span>
                      <span>{locationWeather.temp}°C</span>
                    </div>
                  )}
                  {nearbyConstruction && (
                    <div className="nlm-meta-chip nlm-meta-chip--construction">
                      <span aria-hidden>🚧</span>
                      <span>Construction nearby</span>
                    </div>
                  )}
                </div>

                {/* Stars */}
                <div className="nlm-stars">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className={`nlm-star ${i <= starCount ? 'filled' : 'empty'}`}>
                      {i <= starCount && <div className="star-overlay" />}
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 1.33L10.06 5.51L14.67 6.18L11.33 9.43L12.12 14.01L8 11.85L3.88 14.01L4.67 9.43L1.33 6.18L5.94 5.51L8 1.33Z"
                          fill={i <= starCount ? '#F5A623' : 'none'}
                          stroke={i <= starCount ? '#F5A623' : '#CBD5E1'}
                          strokeWidth={i <= starCount ? '0.5' : '1'}
                          strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ))}
                </div>

                {/* Rating Tags */}
                <div className="nlm-rating-tags">
                  {ratingTags.map((tag) => (
                    <span key={tag} className="nlm-rating-tag">{tag}</span>
                  ))}
                </div>

                {/* Score Bars */}
                {dataSource === 'category' ? (
                  <div style={{ padding: 12, background: 'var(--theme-tag-soft)', borderRadius: 8, color: 'var(--theme-text-muted)', fontSize: 13, marginTop: 8 }}>
                    No data yet — be the first to visit and review.
                  </div>
                ) : (
                  <div className="nlm-score-bars">
                    <div className="nlm-score-row">
                      <span className="nlm-score-label">Noise</span>
                      <div className="nlm-score-bar">
                        <div className="nlm-score-bar-fill" style={{ width: `${(noiseScore / 5) * 100}%` }} />
                      </div>
                      <span className="nlm-score-value">{noiseScore.toFixed(1)}</span>
                    </div>
                    <div className="nlm-score-row">
                      <span className="nlm-score-label">Lighting</span>
                      <div className="nlm-score-bar">
                        <div className="nlm-score-bar-fill" style={{ width: `${(lightingScore / 5) * 100}%` }} />
                      </div>
                      <span className="nlm-score-value">{lightingScore.toFixed(1)}</span>
                    </div>
                    <div className="nlm-score-row">
                      <span className="nlm-score-label">Crowds</span>
                      <div className="nlm-score-bar">
                        <div className="nlm-score-bar-fill" style={{ width: `${(crowdScore / 5) * 100}%` }} />
                      </div>
                      <span className="nlm-score-value">{crowdScore.toFixed(1)}</span>
                    </div>
                    <div className="nlm-score-row">
                      <span className="nlm-score-label">Comfort</span>
                      <div className="nlm-score-bar">
                        <div className="nlm-score-bar-fill" style={{ width: `${(comfortScore / 5) * 100}%` }} />
                      </div>
                      <span className="nlm-score-value">{comfortScore.toFixed(1)}</span>
                    </div>
                  </div>
                )}

                {/* Write a Review button — redirects to login for unauthenticated users */}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    className="nlm-write-review-btn"
                    onClick={() => onLogin()}
                    style={{
                      flex: 1,
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
                  <button
                    className="nlm-directions-btn"
                    onClick={() =>
                      window.open(
                        `https://www.google.com/maps/dir/?api=1&destination=${selectedLocation.latitude},${selectedLocation.longitude}`,
                        '_blank'
                      )
                    }
                    style={{
                      padding: '0 12px',
                      borderRadius: 8,
                      border: '1px solid var(--theme-accent)',
                      background: 'white',
                      color: 'var(--theme-accent)',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Get Directions"
                  >
                    Directions
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sign In Card — compact with info popup */}
        <div className="nlm-signin-card nlm-signin-card--popover-wrap" ref={signinPopoverRef}>
          <div className="nlm-signin-header">
            <div className="nlm-signin-icon">
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.5 12.5C17.5 13.163 17.2366 13.7989 16.7678 14.2678C16.2989 14.7366 15.663 15 15 15H6.66667L2.5 17.5V5C2.5 4.33696 2.76339 3.70107 3.23223 3.23223C3.70107 2.76339 4.33696 2.5 5 2.5H15C15.663 2.5 16.2989 2.76339 16.7678 3.23223C17.2366 3.70107 17.5 4.33696 17.5 5V12.5Z" stroke="var(--theme-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="nlm-signin-text">
              <h3>Sign in to view comments</h3>
            </div>
            <button
              type="button"
              className="nlm-signin-info-btn"
              onClick={toggleSigninDetail}
              aria-label={showSigninDetail ? 'Hide details' : 'Read more about signing in'}
              aria-expanded={showSigninDetail}
              aria-haspopup="dialog"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </button>
          </div>

          <AnimatePresence>
            {showSigninDetail && (
              <motion.div
                key="signin-popup"
                className="nlm-signin-popup"
                role="dialog"
                aria-label="Sign in benefits"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6, scale: 0.98 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
                transition={prefersReducedMotion ? { duration: 0.1 } : { duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="nlm-signin-popup-inner">
                  <p className="nlm-signin-desc">Read community notes, sensory tips, and recent experiences for this place.</p>
                  <ul className="nlm-signin-benefits">
                    <li className="nlm-benefit-item"><span className="nlm-benefit-dot" />See detailed sensory comments</li>
                    <li className="nlm-benefit-item"><span className="nlm-benefit-dot" />Save trusted places and routines</li>
                    <li className="nlm-benefit-item"><span className="nlm-benefit-dot" />Compare your profile to each location</li>
                  </ul>
                  <p className="nlm-signin-note">Comments stay organized and easy to scan so you can decide quickly without overload.</p>
                </div>
                <div className="nlm-signin-popup-arrow" aria-hidden />
              </motion.div>
            )}
          </AnimatePresence>

          <button className="nlm-signin-btn" onClick={handleSignIn}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.25 2.25H14.25C14.6478 2.25 15.0294 2.40804 15.3107 2.68934C15.592 2.97064 15.75 3.35218 15.75 3.75V14.25C15.75 14.6478 15.592 15.0294 15.3107 15.3107C15.0294 15.592 14.6478 15.75 14.25 15.75H11.25" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7.5 12.75L11.25 9L7.5 5.25" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M11.25 9H2.25" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign in
          </button>
        </div>
      </aside>

      {/* ── Mobile location detail bottom sheet (hidden on desktop via CSS) ── */}
      <AnimatePresence>
        {selectedLocation && (
          <>
            <motion.div
              className="nlm-mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setSelectedLocation(null)}
            />
            <motion.div
              className="nlm-mobile-detail"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={prefersReducedMotion ? { duration: 0.1 } : { duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
            >
              {/* Drag handle */}
              <div className="nlm-mobile-detail-handle" aria-hidden="true" />

              {/* Header: name + score + close */}
              <div className="nlm-mobile-detail-header">
                <div className="nlm-mobile-detail-title">
                  <h2>{locationName}</h2>
                  {selectedLocation.category && (
                    <p>{selectedLocation.category}</p>
                  )}
                </div>
                <div className="nlm-score-badge">
                  <span className="score-value">{overallScore}</span>
                  <span className="score-label">{dataSource === 'community' ? `${reviewCount} reviews` : 'AI estimate'}</span>
                </div>
                <button
                  className="nlm-mobile-detail-close"
                  onClick={() => setSelectedLocation(null)}
                  aria-label="Close"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>

              {/* Address / hours / weather / construction chips */}
              {(locationDetail?.address || locationHours?.available || locationWeather || nearbyConstruction) && (
                <div className="nlm-location-meta">
                  {locationDetail?.address && (
                    <div className="nlm-meta-chip">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                      <span>{locationDetail.address.split(',').slice(0, 2).join(',')}</span>
                    </div>
                  )}
                  {locationHours?.available && (
                    <div className={`nlm-meta-chip nlm-meta-chip--${locationHours.open_now ? 'open' : 'closed'}`}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span>{locationHours.open_now ? 'Open now' : 'Closed'}</span>
                    </div>
                  )}
                  {locationWeather && (
                    <div className="nlm-meta-chip">
                      <span aria-hidden>{weatherEmoji(locationWeather.code)}</span>
                      <span>{locationWeather.temp}°C</span>
                    </div>
                  )}
                  {nearbyConstruction && (
                    <div className="nlm-meta-chip nlm-meta-chip--construction">
                      <span aria-hidden>🚧</span>
                      <span>Construction nearby</span>
                    </div>
                  )}
                </div>
              )}

              {/* Stars */}
              <div className="nlm-stars">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className={`nlm-star ${i <= starCount ? 'filled' : 'empty'}`}>
                    {i <= starCount && <div className="star-overlay" />}
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1.33L10.06 5.51L14.67 6.18L11.33 9.43L12.12 14.01L8 11.85L3.88 14.01L4.67 9.43L1.33 6.18L5.94 5.51L8 1.33Z"
                        fill={i <= starCount ? '#F5A623' : 'none'}
                        stroke={i <= starCount ? '#F5A623' : '#CBD5E1'}
                        strokeWidth={i <= starCount ? '0.5' : '1'}
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ))}
              </div>

              {/* Rating tags */}
              <div className="nlm-rating-tags" style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {ratingTags.map((tag) => (
                  <span key={tag} className="nlm-rating-tag">{tag}</span>
                ))}
              </div>

              {/* Score bars */}
              {reviewCount === 0 ? (
                <div style={{ padding: '10px 12px', background: 'var(--theme-tag-soft)', borderRadius: 8, color: 'var(--theme-text-muted)', fontSize: 13 }}>
                  No community data yet — be the first to review.
                </div>
              ) : (
                <div className="nlm-score-bars">
                  {[
                    { label: 'Noise', val: noiseScore },
                    { label: 'Lighting', val: lightingScore },
                    { label: 'Crowds', val: crowdScore },
                    { label: 'Comfort', val: comfortScore },
                  ].map(({ label, val }) => (
                    <div key={label} className="nlm-score-row">
                      <span className="nlm-score-label">{label}</span>
                      <div className="nlm-score-bar">
                        <div className="nlm-score-bar-fill" style={{ width: `${(val / 5) * 100}%` }} />
                      </div>
                      <span className="nlm-score-value">{val.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="nlm-mobile-detail-actions">
                <button
                  className="nlm-mobile-signin-btn"
                  onClick={() => onLogin()}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Sign in &amp; Review
                </button>
                <button
                  className="nlm-mobile-directions-btn"
                  onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedLocation.latitude},${selectedLocation.longitude}`, '_blank')}
                >
                  Directions
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Top Center: Close map */}
      {onBackToHome && (
        <button
          type="button"
          className="nlm-close-map-btn"
          onClick={handleCloseClick}
          aria-label="Close map and return to find places"
        >
          <svg className="nlm-close-map-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
          <span className="nlm-close-map-text">Close map</span>
        </button>
      )}

      {/* Bottom: Search Bar (with integrated category chips) */}
      <div className="nlm-bottom-search">
        <div className="nlm-search-bar-inner">
          <form className="nlm-search-row" onSubmit={handleSearch}>
            <div className="nlm-search-input">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input
                type="text"
                placeholder="Search places or sensory needs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={searchLoading}
              />
            </div>
            <button type="submit" className="nlm-search-btn">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 8H14" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8.66667 3.33L14 8L8.66667 12.67" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Explore nearby
            </button>
          </form>
          <div className="nlm-search-bar-divider" aria-hidden="true" />
          <div className="nlm-category-chips">
            {CATEGORY_CHIPS.map((chip) => (
              <button
                key={chip.title}
                type="button"
                className="nlm-cat-chip"
                onClick={() => handleCategoryClick(chip.filter)}
              >
                <span className="nlm-cat-chip-emoji">{chip.emoji}</span>
                <span className="nlm-cat-chip-title">{chip.title}</span>
              </button>
            ))}
          </div>
        </div>
        {searchNoResults && (
          <p className="nlm-search-no-results">
            No results found for "{searchQuery}"
          </p>
        )}
      </div>
    </motion.div>
  );
}

export default NonLoginMapView;