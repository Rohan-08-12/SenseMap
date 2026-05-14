import { useState, useEffect } from 'react';
import { getAIInsights, getLocationById } from '../services/api';
import { scoreToLabel } from '../utils.js';
import './SavedPlaces.css';

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distLabel(km) {
  if (km == null) return null;
  try {
    const s = JSON.parse(localStorage.getItem('sensorysafe_settings') || '{}');
    if (s.distanceUnit === 'mi') {
      const mi = km * 0.621371;
      return mi < 0.1 ? `${(mi * 5280).toFixed(0)}ft away` : `${mi.toFixed(1)}mi away`;
    }
  } catch { /* ignore */ }
  return km < 1 ? `${(km * 1000).toFixed(0)}m away` : `${km.toFixed(1)}km away`;
}

function matchLabel(score) {
  if (score == null) return null;
  if (score >= 9) return 'Excellent fit';
  if (score >= 7.5) return 'Very good fit';
  if (score >= 5) return 'Good at select times';
  return 'Partial match';
}

function matchBadgeClass(score) {
  if (score >= 9) return 'excellent';
  if (score >= 7.5) return 'good';
  return 'partial';
}

function sensoryMatch10(matchPercent) {
  if (matchPercent == null) return null;
  return (matchPercent / 10).toFixed(1);
}

function matchDescription(score10, userProfile) {
  if (score10 == null || !userProfile) return 'Set up your sensory profile for match scores';
  if (score10 >= 9) return 'Strong match with your current profile';
  if (score10 >= 7.5) return 'Low-noise option for focused visits';
  if (score10 >= 5) return 'Best with time-aware planning';
  return 'Might not fully match your preferences';
}

const SORT_OPTIONS = [
  { id: 'match-desc', label: 'Best match first' },
  { id: 'distance-asc', label: 'Nearest first' },
  { id: 'noise-asc', label: 'Quietest first' },
  { id: 'crowd-asc', label: 'Least crowded first' },
  { id: 'name-asc', label: 'Name A–Z' },
];

function SavedPlaces({ savedPlacesList = [], userCoords, userProfile, matchScores = [], onRemovePlace, onBack }) {
  const [filterText, setFilterText] = useState('');
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [sortBy, setSortBy] = useState('match-desc');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const places = savedPlacesList.map((s) => {
    const loc = s.location || {};
    const scores = loc.sensoryScores || {};
    const locId = loc.id || s.locationId;
    const ms = matchScores.find((m) => m.locationId === locId);
    const matchPct = ms?.matchScore ?? null;
    const score10 = sensoryMatch10(matchPct);

    let km = null;
    if (userCoords && loc.latitude != null && loc.longitude != null) {
      km = haversineKm(userCoords.lat, userCoords.lng, loc.latitude, loc.longitude);
    }

    return {
      id: locId,
      name: loc.name || 'Unknown',
      category: loc.category || '',
      address: loc.address || '',
      description: loc.description || '',
      imageUrl: loc.imageUrl || null,
      latitude: loc.latitude,
      longitude: loc.longitude,
      comfort: scores.comfortScore ?? 0,
      noise: scores.noiseScore ?? 0,
      lighting: scores.lightingScore ?? 0,
      crowd: scores.crowdScore ?? 0,
      reviewCount: scores.reviewCount ?? 0,
      matchPct,
      score10: score10 != null ? parseFloat(score10) : null,
      km,
    };
  });

  const strongMatches = places.filter((p) => p.score10 != null && p.score10 >= 7.5).length;
  const nearbyCount = places.filter((p) => p.km != null && p.km < 3).length;

  const filtered = places.filter((p) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || p.address.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'match-desc': return (b.score10 ?? -1) - (a.score10 ?? -1);
      case 'distance-asc': return (a.km ?? Infinity) - (b.km ?? Infinity);
      case 'noise-asc': return a.noise - b.noise;
      case 'crowd-asc': return a.crowd - b.crowd;
      case 'name-asc': return a.name.localeCompare(b.name);
      default: return 0;
    }
  });

  if (selectedPlace) {
    return (
      <SavedPlaceDetail
        place={selectedPlace}
        userProfile={userProfile}
        userCoords={userCoords}
        onBack={() => setSelectedPlace(null)}
        onRemove={async () => { await onRemovePlace(selectedPlace.id); setSelectedPlace(null); }}
      />
    );
  }

  return (
    <div className="sp-list-view">
      {/* Top bar */}
      <div className="sp-topbar">
        <span className="sp-topbar-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12.25 14.75L8 11L3.75 14.75V3.25C3.75 2.85 3.91 2.47 4.19 2.19C4.47 1.91 4.85 1.75 5.25 1.75H10.75C11.15 1.75 11.53 1.91 11.81 2.19C12.09 2.47 12.25 2.85 12.25 3.25V14.75Z" stroke="var(--theme-text)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Saved Places List
        </span>
        <div className="sp-topbar-actions">
          <div className="sp-filter-dropdown-wrap">
            <button type="button" className="sp-btn-outline" onClick={() => setShowFilterMenu((v) => !v)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="var(--theme-text)" strokeWidth="1.3" strokeLinecap="round"/></svg>
              {SORT_OPTIONS.find((o) => o.id === sortBy)?.label || 'Filter'}
            </button>
            {showFilterMenu && (
              <div className="sp-filter-menu">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`sp-filter-option ${sortBy === opt.id ? 'active' : ''}`}
                    onClick={() => { setSortBy(opt.id); setShowFilterMenu(false); }}
                  >
                    {sortBy === opt.id && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 7l2.5 2.5L10.5 5" stroke="var(--theme-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="sp-btn-primary" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="white" strokeWidth="1.3"/><path d="M8 2v1M8 13v1M2 8h1M13 8h1" stroke="white" strokeWidth="1.3" strokeLinecap="round"/></svg>
            View on map
          </button>
        </div>
      </div>

      <div className="sp-list-scroll">
        {/* Hero section */}
        <div className="sp-hero">
          <div className="sp-hero-left">
            <span className="sp-hero-badge">your calm shortlist</span>
            <h1>Places you saved for easier, lower-stress planning.</h1>
            <p className="sp-hero-desc">
              Revisit locations that matched your sensory preferences, compare comfort scores, and quickly return to places that feel more predictable and supportive.
            </p>
            <div className="sp-hero-stats">
              <div className="sp-hero-stat">
                <span className="sp-stat-label">Saved places</span>
                <span className="sp-stat-val">{places.length}</span>
              </div>
              <div className="sp-hero-stat">
                <span className="sp-stat-label">Strong matches</span>
                <span className="sp-stat-val">{strongMatches}</span>
              </div>
              <div className="sp-hero-stat">
                <span className="sp-stat-label">Nearby now</span>
                <span className="sp-stat-val">{nearbyCount}</span>
              </div>
            </div>
          </div>
          <div className="sp-hero-note">
            <h4>Quick note</h4>
            <p>Your list is ranked using your current sensory profile, recent community reports, and time-of-day comfort patterns.</p>
          </div>
        </div>

        {/* Filter bar */}
        {places.length > 3 && (
          <div className="sp-filter-bar">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="8.25" cy="8.25" r="4.5" stroke="var(--theme-text-muted)" strokeWidth="1.5"/><path d="M15.75 15.75L11.5 11.5" stroke="var(--theme-text-muted)" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <input type="text" placeholder="Search saved places…" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
          </div>
        )}

        {/* Place cards */}
        {sorted.length === 0 ? (
          <div className="sp-empty-card">
            <p>{places.length === 0 ? 'No saved places yet.' : `No places match "${filterText}".`}</p>
            {places.length === 0 && <p className="sp-empty-hint">Save locations from the map to build your trusted list.</p>}
          </div>
        ) : (
          sorted.map((place) => (
            <div key={place.id} className="sp-place-card">
              <div className="sp-place-image">
                {place.imageUrl ? (
                  <img src={place.imageUrl} alt={place.name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                ) : (
                  <div className="sp-place-image-placeholder">
                    <span>{place.name.charAt(0)}</span>
                  </div>
                )}
              </div>

              <div className="sp-place-body">
                <div className="sp-place-title-row">
                  <h3>{place.name}</h3>
                  {place.score10 != null && (
                    <span className={`sp-fit-badge ${matchBadgeClass(place.score10)}`}>
                      {matchLabel(place.score10)}
                    </span>
                  )}
                </div>
                <p className="sp-place-meta">
                  {distLabel(place.km) || '—'} • {place.category || 'Location'} • {scoreToLabel(place.crowd)} crowding
                </p>
                <p className="sp-place-desc">
                  {place.description || `A ${place.category?.toLowerCase() || 'location'} with noise level ${scoreToLabel(place.noise).toLowerCase()}, ${scoreToLabel(place.lighting).toLowerCase()} lighting, and ${scoreToLabel(place.crowd).toLowerCase()} crowd levels.`}
                </p>
                <div className="sp-place-tags">
                  {place.noise < 2 && <span className="sp-tag">Quiet environment</span>}
                  {place.lighting < 2.5 && <span className="sp-tag">Soft lighting</span>}
                  {place.crowd < 2 && <span className="sp-tag">Low crowds</span>}
                  {place.comfort >= 3.5 && <span className="sp-tag">Comfortable</span>}
                  {place.category && <span className="sp-tag">{place.category}</span>}
                </div>
              </div>

              <div className="sp-place-score-col">
                <div className="sp-place-match-card">
                  <span className="sp-match-small-label">Sensory match</span>
                  <div className="sp-match-big-score">
                    <span className="sp-match-num">{place.score10 != null ? place.score10.toFixed(1) : '—'}</span>
                    <span className="sp-match-denom">/10</span>
                  </div>
                  <p className="sp-match-note">{matchDescription(place.score10, userProfile)}</p>
                </div>
                <button type="button" className="sp-open-detail" onClick={() => setSelectedPlace(place)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8.67 3.33L12.33 7l-3.66 3.67" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Open details
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/* Saved Place Detail View                    */
/* ═══════════════════════════════════════════ */
function SavedPlaceDetail({ place, onBack, onRemove }) {
  const [detail, setDetail] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (!place?.id) return;
    getLocationById(place.id).then((r) => setDetail(r.data)).catch(() => {});
    setAiLoading(true);
    getAIInsights(place.id).then((r) => setAiInsights(r.data || null)).catch(() => setAiInsights(null)).finally(() => setAiLoading(false));
  }, [place?.id]);

  const scores = detail?.sensoryScores || {};
  const reviews = detail?.reviews || [];
  const avgRating = reviews.length > 0 ? (reviews.reduce((a, r) => a + (r.rating || 0), 0) / reviews.length) : 0;
  const dist = place.km != null ? distLabel(place.km) : null;

  const noiseScore = scores.noiseScore ?? place.noise ?? 0;
  const lightScore = scores.lightingScore ?? place.lighting ?? 0;
  const crowdScore = scores.crowdScore ?? place.crowd ?? 0;
  const comfortScore = scores.comfortScore ?? place.comfort ?? 0;

  const totalScoreSum = noiseScore + lightScore + crowdScore + comfortScore;
  const noisePct = totalScoreSum > 0 ? ((noiseScore / totalScoreSum) * 100).toFixed(0) : 0;
  const crowdPct = totalScoreSum > 0 ? ((crowdScore / totalScoreSum) * 100).toFixed(0) : 0;
  const lightPct = totalScoreSum > 0 ? ((lightScore / totalScoreSum) * 100).toFixed(0) : 0;

  // Crowd threshold alert
  const crowdAlert = crowdScore > 3 || (aiInsights?.crowd?.score > 3);
  const noiseAlert = noiseScore > 3 || (aiInsights?.noise?.score > 3);

  const handleRemove = async () => {
    setRemoving(true);
    try { await onRemove(); } finally { setRemoving(false); }
  };

  const aiTags = aiInsights?.tags || [];
  const triggerTags = [];
  if (crowdScore > 3) triggerTags.push('Gets busier after 4pm');
  if (noiseScore > 3) triggerTags.push('Louder at peak hours');

  return (
    <div className="spd-layout">
      {/* Center column */}
      <div className="spd-center">
        {/* Top bar */}
        <div className="spd-topbar">
          <button type="button" className="spd-back-btn" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 4L6 8l4 4" stroke="var(--theme-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back to Saved Places
          </button>
          <div className="spd-topbar-actions">
            <button 
              type="button" 
              className="sp-btn-primary"
              onClick={() =>
                window.open(
                  `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`,
                  '_blank'
                )
              }
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M8.67 3.33L14 8l-5.33 4.67" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Get Directions
            </button>
          </div>
        </div>

        <div className="spd-scroll">
          {/* Hero image */}
          <div className="spd-hero-image">
            {(place.imageUrl || detail?.imageUrl || reviews.find((r) => r.imageUrl)?.imageUrl) ? (
              <img src={place.imageUrl || detail?.imageUrl || reviews.find((r) => r.imageUrl).imageUrl} alt={place.name} />
            ) : (
              <div className="spd-hero-gradient">
                <span>{place.name}</span>
              </div>
            )}
            <div className="spd-hero-tags">
              {place.crowd < 2.5 && <span className="spd-hero-tag">Lower crowding</span>}
              {place.noise < 2.5 && <span className="spd-hero-tag">Quiet area</span>}
              {place.category && <span className="spd-hero-tag">{place.category}</span>}
            </div>
          </div>

          {/* Title + match score */}
          <div className="spd-title-section">
            <div className="spd-title-left">
              <span className="spd-profile-badge">Location sensory profile</span>
              <h1>{place.name}</h1>
              <p className="spd-title-meta">{dist || '—'} • {place.category || 'Location'} • {scoreToLabel(place.crowd)} crowding</p>
              <p className="spd-title-desc">
                {place.description || (detail?.description) || `Visitors with sensory sensitivities describe ${place.name} as ${scoreToLabel(noiseScore).toLowerCase()} noise, ${scoreToLabel(lightScore).toLowerCase()} lighting, and comfortable for shorter visits.`}
              </p>
            </div>
            <div className="spd-match-box">
              <span className="spd-match-label">Sensory Match Score</span>
              <div className="spd-match-score-big">
                <span className="spd-match-num">{place.score10 != null ? place.score10.toFixed(1) : '—'}</span>
                <span className="spd-match-denom">/10</span>
              </div>
              {place.score10 != null && (
                <span className={`spd-fit-badge ${matchBadgeClass(place.score10)}`}>{matchLabel(place.score10)}</span>
              )}
              <span className="spd-match-sub">Based on your profile</span>
            </div>
          </div>

          {/* AI Review Insights */}
          <div className="spd-card">
            <div className="spd-card-header">
              <div>
                <h3>AI Review Insights</h3>
                <p className="spd-card-desc">Analyzed from {reviews.length} recent community reviews matching your sensory needs.</p>
              </div>
              <span className="spd-ai-badge">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.25" stroke="var(--theme-accent)" strokeWidth="1.2"/><path d="M5.25 7h3.5M7 5.25v3.5" stroke="var(--theme-accent)" strokeWidth="1.2" strokeLinecap="round"/></svg>
                AI Summary
              </span>
            </div>
            {aiLoading ? (
              <p className="spd-muted">Loading AI insights…</p>
            ) : aiInsights ? (
              <>
                <div className="spd-ai-tags">
                  {aiTags.map((tag) => (
                    <span key={tag} className="spd-ai-tag positive">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12.25 7A5.25 5.25 0 111.75 7a5.25 5.25 0 0110.5 0z" stroke="#05360d" strokeWidth="1.2"/><path d="M4.5 7l2 2 3.5-3.5" stroke="#05360d" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      {tag}
                    </span>
                  ))}
                  {triggerTags.map((tag) => (
                    <span key={tag} className="spd-ai-tag warning">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.25" stroke="#92400e" strokeWidth="1.2"/><path d="M7 4.5v3M7 9.5h.01" stroke="#92400e" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="spd-ai-conf">
                  <span className="spd-ai-conf-label">AI Confidence Score</span>
                  <div className="spd-ai-conf-bar"><div className="spd-ai-conf-fill" style={{ width: `${aiInsights.confidence ?? 0}%` }} /></div>
                  <span className="spd-ai-conf-val">{aiInsights.confidence ?? 0}%</span>
                </div>
              </>
            ) : (
              <p className="spd-muted">No reviews available for AI analysis yet.</p>
            )}
          </div>

          {/* Community ratings */}
          <div className="spd-card">
            <div className="spd-card-header">
              <div>
                <h3>Community ratings</h3>
                <p className="spd-card-desc">Recent ratings from sensory-sensitive visitors at {place.name}.</p>
              </div>
              {reviews.length > 0 && <span className="spd-rating-count">{reviews.length} rating{reviews.length !== 1 ? 's' : ''}</span>}
            </div>
            {reviews.length > 0 ? (
              <div className="spd-community">
                <div className="spd-community-left">
                  <div className="spd-overall-rating">
                    <span className="spd-rating-big">{avgRating.toFixed(1)}</span>
                    <span className="spd-rating-of">out of 10</span>
                  </div>
                  <div className="spd-stars">
                    {[2, 4, 6, 8, 10].map((s) => (
                      <svg key={s} width="18" height="18" viewBox="0 0 18 18" fill={s <= Math.round(avgRating) ? '#f59e0b' : '#e5e7eb'}>
                        <path d="M9 1.5l2.47 5.01 5.53.8-4 3.9.94 5.49L9 14.01 4.06 16.7 5 11.21l-4-3.9 5.53-.8L9 1.5z"/>
                      </svg>
                    ))}
                  </div>
                  <p className="spd-rating-hint">Most visitors describe it as comfortable and easy to plan around.</p>
                </div>
                <div className="spd-community-right">
                  <div className="spd-bar-row"><span className="spd-bar-label">Quietness</span><div className="spd-bar-track"><div className="spd-bar-fill blue" style={{ width: `${((5 - noiseScore) / 5) * 100}%` }} /></div><span className="spd-bar-val">{(10 - noiseScore * 2).toFixed(1)} / 10</span></div>
                  <div className="spd-bar-row"><span className="spd-bar-label">Crowding comfort</span><div className="spd-bar-track"><div className="spd-bar-fill teal" style={{ width: `${((5 - crowdScore) / 5) * 100}%` }} /></div><span className="spd-bar-val">{(10 - crowdScore * 2).toFixed(1)} / 10</span></div>
                  <div className="spd-bar-row"><span className="spd-bar-label">Lighting comfort</span><div className="spd-bar-track"><div className="spd-bar-fill purple" style={{ width: `${((5 - lightScore) / 5) * 100}%` }} /></div><span className="spd-bar-val">{(10 - lightScore * 2).toFixed(1)} / 10</span></div>
                  <div className="spd-bar-row"><span className="spd-bar-label">Predictability</span><div className="spd-bar-track"><div className="spd-bar-fill green" style={{ width: `${(comfortScore / 5) * 100}%` }} /></div><span className="spd-bar-val">{(comfortScore * 2).toFixed(1)} / 10</span></div>
                </div>
              </div>
            ) : (
              <p className="spd-muted">No community ratings yet.</p>
            )}
          </div>

          {/* Recent review comments */}
          {reviews.length > 0 && (
            <div className="spd-card">
              <div className="spd-card-header">
                <div>
                  <h3>Recent review comments</h3>
                  <p className="spd-card-desc">Helpful first-person notes from visitors with similar sensory preferences.</p>
                </div>
                <span className="spd-sort-badge">Sorted by relevance</span>
              </div>
              <div className="spd-reviews">
                {reviews.slice(0, 5).map((r) => (
                  <div key={r.id} className="spd-review">
                    <div className="spd-review-header">
                      <div className="spd-review-avatar">{(r.userId || 'U').charAt(0).toUpperCase()}</div>
                      <div className="spd-review-user">
                        <span className="spd-review-name">Visitor</span>
                        <span className="spd-review-type">
                          {r.noiseLevel != null && r.noiseLevel < 3 ? 'Noise-sensitive profile' : r.lightingLevel != null && r.lightingLevel < 3 ? 'Light-sensitive profile' : 'Sensory-aware visitor'}
                        </span>
                      </div>
                      <div className="spd-review-stars">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <svg key={s} width="14" height="14" viewBox="0 0 14 14" fill={s <= (r.rating || 0) ? '#f59e0b' : '#e5e7eb'}>
                            <path d="M7 1l1.93 3.9 4.31.63-3.12 3.04.74 4.28L7 10.52 3.14 12.85l.74-4.28L.76 5.53l4.31-.63L7 1z"/>
                          </svg>
                        ))}
                      </div>
                    </div>
                    <p className="spd-review-text">"{r.bodyText}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar */}
      <div className="spd-sidebar">
        {/* Crowd threshold alert */}
        {(crowdAlert || noiseAlert) && (
          <div className="spd-sidebar-card alert">
            <div className="spd-alert-icon">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="#ea580c" strokeWidth="1.5"/><path d="M9 5.5v4M9 12.5h.01" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </div>
            <h4>Crowd Threshold Alert</h4>
            <p>
              {crowdAlert && `Expected crowds may exceed your preferred threshold. `}
              {noiseAlert && `Noise levels may be higher at peak times.`}
            </p>
            <span className="spd-alert-tip">Tip: Plan to leave by 3:30 PM</span>
          </div>
        )}

        {reviews.length === 0 && (
          <div className="spd-sidebar-card" style={{ color: 'var(--theme-text-muted)', fontSize: 13 }}>
            <h4 style={{ marginBottom: 8 }}>No data yet</h4>
            <p>Radar chart, comfort breakdown, and time patterns will appear once this place has community visits.</p>
          </div>
        )}

        {/* Sensory Radar Chart (simplified visual) */}
        {reviews.length > 0 && (
          <div className="spd-sidebar-card">
            <h4>Sensory Radar Chart</h4>
            <p className="spd-sidebar-desc">Environmental profile overview</p>
            <div className="spd-radar">
              <div className="spd-radar-axis">
                <span className="spd-radar-label top">Noise</span>
                <span className="spd-radar-label right">Crowds</span>
                <span className="spd-radar-label bottom">Smell</span>
                <span className="spd-radar-label left">Lighting</span>
              </div>
              <div className="spd-radar-grid">
                <div className="spd-radar-ring r1"></div>
                <div className="spd-radar-ring r2"></div>
                <div className="spd-radar-ring r3"></div>
                <svg className="spd-radar-shape" viewBox="0 0 100 100">
                  <polygon
                    points={`50,${50 - (noiseScore / 5) * 40} ${50 + (crowdScore / 5) * 40},50 50,${50 + (comfortScore / 5) * 40} ${50 - (lightScore / 5) * 40},50`}
                    fill="rgba(75, 139, 255, 0.2)"
                    stroke="var(--theme-accent)"
                    strokeWidth="2"
                  />
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* Comfort Score Breakdown */}
        {reviews.length > 0 && (
          <div className="spd-sidebar-card">
            <h4>Comfort Score Breakdown</h4>
            <p className="spd-sidebar-desc">How we calculated your {(place.score10 ?? comfortScore).toFixed?.(1) || '—'} score</p>
            <div className="spd-breakdown">
              <div className="spd-bd-row">
                <span>Noise Impact ({noisePct}%)</span>
                <div className="spd-bd-bar"><div className="spd-bd-fill" style={{ width: `${noisePct}%`, background: 'var(--theme-accent)' }} /></div>
              </div>
              <div className="spd-bd-row">
                <span>Crowds Impact ({crowdPct}%)</span>
                <div className="spd-bd-bar"><div className="spd-bd-fill" style={{ width: `${crowdPct}%`, background: 'var(--theme-accent-soft)' }} /></div>
              </div>
              <div className="spd-bd-row">
                <span>Lighting Impact ({lightPct}%)</span>
                <div className="spd-bd-bar"><div className="spd-bd-fill" style={{ width: `${lightPct}%`, background: '#a78bfa' }} /></div>
              </div>
            </div>
          </div>
        )}

        {/* Sensory Time Pattern */}
        {reviews.length > 0 && (
          <div className="spd-sidebar-card">
            <h4>Sensory Time Pattern</h4>
            <p className="spd-sidebar-desc">Activity levels throughout the day</p>
            <div className="spd-time-chart">
              {(() => {
                const pattern = [0.35, 0.65, 1.0, 0.55];
                const clamp = (v) => Math.round(Math.max(15, Math.min(100, v)));
                const noiseH = pattern.map(b => clamp(b * (noiseScore / 5) * 100));
                const crowdH = pattern.map(b => clamp(b * (crowdScore / 5) * 100));
                const lightH = pattern.map(b => clamp(b * (lightScore / 5) * 100));
                return ['6am', '12pm', '6pm', '10pm'].map((t, i) => (
                  <div key={t} className="spd-time-bar-group">
                    <div className="spd-time-bars">
                      <div className="spd-time-bar noise" style={{ height: `${noiseH[i]}%` }} />
                      <div className="spd-time-bar crowd" style={{ height: `${crowdH[i]}%` }} />
                      <div className="spd-time-bar light" style={{ height: `${lightH[i]}%` }} />
                    </div>
                    <span className="spd-time-label">{t}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* Remove button */}
        <button type="button" className="spd-remove-btn" onClick={handleRemove} disabled={removing}>
          {removing ? 'Removing…' : 'Remove from saved'}
        </button>
      </div>
    </div>
  );
}

export default SavedPlaces;
