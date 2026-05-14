import { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { getAIInsights, getRecentCheckIns } from '../services/api';
import { haversineDistance } from '../utils.js';
import './Dashboard.css';

// Profile tolerance 1–5 → display label
const toleranceToLabel = (v) => (v == null ? '—' : v < 2 ? 'Low' : v < 3.5 ? 'Medium' : 'High');
// 1–5 → percent for slider (0–100)
const toleranceToPercent = (v) => (v == null ? 50 : ((Number(v) - 1) / 4) * 100);
// Slider config for sensory profile
const SLIDER_CONFIG = [
  { key: 'noiseTolerance', label: 'Noise tolerance', min: 'Quiet', max: 'Busy' },
  { key: 'lightingTolerance', label: 'Lighting sensitivity', min: 'Dim', max: 'Bright' },
  { key: 'crowdTolerance', label: 'Crowd tolerance', min: 'Calm', max: 'Crowded' },
];

function Dashboard({
  userProfile,
  savedPlacesList = [],
  bestMatch,
  userCoords,
  snapshot,
  onEditProfile,
  onViewAllSaved,
  onCalmRoute,
  onSearchGo,
}) {
  const { user } = useAuth0();
  const userName = user?.given_name || user?.name?.split(' ')[0] || 'there';

  const [searchInput, setSearchInput] = useState('');
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(false);
  const [recentCheckIns, setRecentCheckIns] = useState([]);

  // Fetch AI insights for best match when we have a location with id
  const bestMatchLocationId = bestMatch?.locationId ?? bestMatch?.id;
  useEffect(() => {
    if (!bestMatchLocationId) {
      setAiInsights(null);
      setAiError(false);
      return;
    }
    setAiLoading(true);
    setAiError(false);
    getAIInsights(bestMatchLocationId)
      .then((res) => {
        setAiInsights(res.data || null);
      })
      .catch(() => {
        setAiError(true);
        setAiInsights(null);
      })
      .finally(() => setAiLoading(false));
  }, [bestMatchLocationId]);

  useEffect(() => {
    getRecentCheckIns()
      .then((res) => setRecentCheckIns(res.data || []))
      .catch(() => {});
  }, []);

  const handleSearchSubmit = (e) => {
    e?.preventDefault();
    const q = searchInput?.trim();
    if (q && onSearchGo) onSearchGo(q);
  };

  // Env stats from profile (or snapshot as fallback)
  const noiseLabel = userProfile ? toleranceToLabel(userProfile.noiseTolerance) : (snapshot?.noiseTrend ?? '—');
  const lightingLabel = userProfile ? toleranceToLabel(userProfile.lightingTolerance) : '—';
  const crowdLabel = userProfile ? toleranceToLabel(userProfile.crowdTolerance) : '—';

  // Best match distance
  const bestMatchDistance =
    bestMatch && userCoords && bestMatch.latitude != null && bestMatch.longitude != null
      ? haversineDistance(userCoords.lat, userCoords.lng, bestMatch.latitude, bestMatch.longitude)
      : null;

  // Normalize saved places for list (backend: { location: { name, address, sensoryScores }, locationId } )
  const savedPlaces = savedPlacesList.map((s) => {
    const loc = s.location || {};
    const scores = loc.sensoryScores || {};
    const comfort = scores.comfortScore ?? scores.comfort ?? 0;
    const noise = scores.noiseScore ?? scores.noise ?? 0;
    const light = scores.lightingScore ?? scores.lighting ?? 0;

    const parts = [];
    if (userCoords && loc.latitude != null && loc.longitude != null) {
      parts.push(haversineDistance(userCoords.lat, userCoords.lng, loc.latitude, loc.longitude));
    }
    parts.push(`Noise ${toleranceToLabel(noise)}`);
    parts.push(`Lighting ${toleranceToLabel(light)}`);

    return {
      id: loc.id || s.locationId,
      name: loc.name || 'Unknown',
      meta: parts.join(' • ') || (loc.address || '—'),
      score: (comfort || 0).toFixed(1),
      tier: (comfort ?? 0) >= 3.5 ? 'high' : 'medium',
    };
  });

  return (
    <div className="dash">
      <div className="dash-center">
        <div className="dash-header">
          <form className="dash-search" onSubmit={handleSearchSubmit}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="8.25" cy="8.25" r="4.5" stroke="#6b7280" strokeWidth="1.5" />
              <path d="M15.75 15.75L11.5 11.5" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search a place or tag"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search places"
            />
          </form>
          <div className="dash-header-actions">
            <button type="button" className="dash-btn-outline" onClick={onCalmRoute} aria-label="Show calm route">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h12M8.67 3.33L14 8l-5.33 4.67" stroke="#0f1720" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Calm route
            </button>
            <button type="button" className="dash-btn-primary" onClick={onEditProfile} aria-label="Edit sensory profile">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v12M4 6l4-4 4 4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Edit profile
            </button>
          </div>
        </div>

        <div className="dash-scroll">
          <div className="dash-welcome">
            <div className="dash-welcome-left">
              <span className="dash-overview-badge">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.25" stroke="#0f1720" strokeWidth="1.2" />
                  <path d="M7 4v3l2.25 1.25" stroke="#0f1720" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Today's overview
              </span>
              <h2>Welcome back, {userName}.</h2>
              <p className="dash-welcome-desc">
                Your dashboard is focused on the few things you need most today: your profile, trusted places, and nearby matches.
              </p>
              <div className="dash-env-stats">
                <div className="dash-env-stat">
                  <div className="dash-env-stat-label">Noise</div>
                  <div className="dash-env-stat-value">{noiseLabel}</div>
                </div>
                <div className="dash-env-stat">
                  <div className="dash-env-stat-label">Lighting</div>
                  <div className="dash-env-stat-value">{lightingLabel}</div>
                </div>
                <div className="dash-env-stat">
                  <div className="dash-env-stat-label">Crowds</div>
                  <div className="dash-env-stat-value">{crowdLabel}</div>
                </div>
              </div>
            </div>

            <div className="dash-match-card">
              {bestMatch ? (
                <>
                  <div>
                    <h3 className="dash-match-title">Best nearby match</h3>
                    <p className="dash-match-desc">
                      {bestMatch.name} matches your settings{userProfile ? ' well' : ''}.
                    </p>
                  </div>
                  <div>
                    <div className="dash-match-score-row">
                      <span className="dash-match-score-label">Match score</span>
                      <span className="dash-match-score-val">{bestMatch.matchScore ?? 0}%</span>
                    </div>
                    <div className="dash-match-bar" style={{ marginTop: 8 }}>
                      <div className="dash-match-bar-fill" style={{ width: `${Math.min(100, bestMatch.matchScore ?? 0)}%` }} />
                    </div>
                  </div>
                  <span className="dash-match-status">
                    {bestMatchDistance || '—'} {snapshot?.noiseTrend ? `• ${snapshot.noiseTrend} nearby` : ''}
                  </span>
                </>
              ) : (
                <div>
                  <h3 className="dash-match-title">Best nearby match</h3>
                  <p className="dash-match-desc">
                    {userProfile
                      ? 'No match data yet. Check back after locations are loaded.'
                      : 'Set up your sensory profile to see personalized matches.'}
                  </p>
                  <span className="dash-match-status">—</span>
                </div>
              )}
            </div>
          </div>

          <div className="dash-bottom-row">
            <div className="dash-section">
              <div>
                <h3 className="dash-section-title">Sensory profile</h3>
                <p className="dash-section-desc">Only the main preferences are shown here for easier scanning.</p>
              </div>

              {userProfile ? (
                <div className="dash-sliders">
                  {SLIDER_CONFIG.map(({ key, label, min, max }) => {
                    const value = userProfile[key];
                    const percent = toleranceToPercent(value);
                    const tag = toleranceToLabel(value);
                    return (
                      <div className="dash-slider-group" key={key}>
                        <div className="dash-slider-header">
                          <span className="dash-slider-label">{label}</span>
                          <span className="dash-slider-tag">{tag}</span>
                        </div>
                        <div className="dash-slider-track">
                          <div className="dash-slider-fill" style={{ width: `${percent}%` }} />
                          <div className="dash-slider-thumb" style={{ left: `${percent}%` }} />
                        </div>
                        <div className="dash-slider-labels">
                          <span className="dash-slider-min">{min}</span>
                          <span className="dash-slider-max">{max}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="dash-section-desc" style={{ marginTop: 8 }}>
                  Load your profile to see preferences, or use Edit profile to set them.
                </p>
              )}

              <div className="dash-preview">
                <h4 className="dash-preview-title">Preview</h4>
                <p className="dash-preview-text">
                  {userProfile
                    ? `Recommendations favor ${noiseLabel.toLowerCase()} noise, ${lightingLabel.toLowerCase()} lighting, and ${crowdLabel.toLowerCase()} crowds.`
                    : 'Set your sensory profile to get tailored recommendations.'}
                </p>
              </div>
            </div>

            <div className="dash-section">
              <div className="dash-saved-header">
                <div className="dash-saved-header-text">
                  <h3>Saved places</h3>
                  <p>A short list of trusted locations.</p>
                </div>
                <button type="button" className="dash-view-all" onClick={onViewAllSaved}>
                  View all
                </button>
              </div>

              <div className="dash-places-list">
                {savedPlaces.length === 0 ? (
                  <p className="dash-place-empty">No saved places yet. Save locations from the map to see them here.</p>
                ) : (
                  savedPlaces.slice(0, 5).map((place) => (
                    <div className="dash-place-item" key={place.id || place.name}>
                      <div>
                        <div className="dash-place-name">{place.name}</div>
                        <div className="dash-place-meta">{place.meta}</div>
                      </div>
                      <span className={`dash-place-score ${place.tier}`}>{place.score}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="dash-right">
        <div className="dash-right-card">
          <div>
            <h3 className="dash-right-title">AI insight</h3>
            <p className="dash-right-desc">A single, easy-to-read summary for your selected place.</p>
          </div>

          {aiLoading ? (
            <div className="dash-confidence-row">
              <span className="dash-confidence-badge">Confidence</span>
              <span className="dash-confidence-val">…</span>
            </div>
          ) : aiError || !aiInsights ? (
            <p className="dash-right-desc" style={{ marginTop: 8 }}>
              {bestMatch
                ? 'No reviews for this place yet, or insight unavailable.'
                : 'Your best match will show AI insight here when available.'}
            </p>
          ) : (
            <>
              <div className="dash-confidence-row">
                <span className="dash-confidence-badge">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.25" stroke="#0f1720" strokeWidth="1.2" />
                    <path d="M5.25 7h3.5M7 5.25v3.5" stroke="#0f1720" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  Confidence
                </span>
                <span className="dash-confidence-val">{aiInsights.confidence ?? 0}%</span>
              </div>
              <div className="dash-confidence-bar">
                <div className="dash-confidence-bar-fill" style={{ width: `${aiInsights.confidence ?? 0}%` }} />
              </div>
              <div className="dash-factors-card">
                <div className="dash-factors-icon">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2.5 8a5.5 5.5 0 0111 0" stroke="#6b7280" strokeWidth="1.3" strokeLinecap="round" />
                    <path d="M5.5 10.5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5" stroke="#6b7280" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="dash-factors-text">
                  <h4>Likely sensory factors</h4>
                  <p>
                    {[aiInsights.noise?.summary, aiInsights.lighting?.summary, aiInsights.crowd?.summary]
                      .filter(Boolean)
                      .join(' ') || 'No summary available.'}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="dash-right-card">
          <div>
            <h3 className="dash-right-title">Before you go</h3>
            <p className="dash-right-desc">Simple preparation guidance.</p>
          </div>
          {aiInsights ? (
            <div className="dash-tips-list">
              {aiInsights.bestTime && (
                <div className="dash-tip-item">
                  <div className="dash-tip-title">Best time</div>
                  <div className="dash-tip-text">{aiInsights.bestTime}</div>
                </div>
              )}
              {Array.isArray(aiInsights.preparationGuide) && aiInsights.preparationGuide.length > 0 && (
                <div className="dash-tip-item">
                  <div className="dash-tip-title">Helpful tip</div>
                  <div className="dash-tip-text">{aiInsights.preparationGuide[0]}</div>
                </div>
              )}
              {!aiInsights.bestTime && (!aiInsights.preparationGuide || aiInsights.preparationGuide.length === 0) && (
                <p className="dash-right-desc">No preparation tips for this place yet.</p>
              )}
            </div>
          ) : (
            <p className="dash-right-desc">Based on your best match. View the map to see details for other places.</p>
          )}
        </div>

        <div className="dash-right-card">
          <div>
            <h3 className="dash-right-title">Soft alert</h3>
            <p className="dash-right-desc">Only shown when there may be a concern.</p>
          </div>
          {aiInsights && (aiInsights.sentiment === 'negative' || (aiInsights.crowd?.score > 3.5 || aiInsights.noise?.score > 3.5)) ? (
            <div className="dash-alert-box">
              <h4 className="dash-alert-title">Possible triggers later today</h4>
              <p className="dash-alert-text">
                {aiInsights.crowd?.score > 3.5 && 'Dense crowds possible. '}
                {aiInsights.noise?.score > 3.5 && 'Noise may be higher at peak times. '}
                {aiInsights.bestTime || 'Consider visiting during quieter hours.'}
              </p>
              <span className="dash-alert-action">Plan for an earlier visit</span>
            </div>
          ) : (
            <p className="dash-right-desc" style={{ marginTop: 8 }}>
              No alerts right now. Conditions look okay for your best match.
            </p>
          )}
        </div>

        <div className="dash-right-card">
          <div>
            <h3 className="dash-right-title">Recent visits</h3>
            <p className="dash-right-desc">Places you checked into recently.</p>
          </div>
          {recentCheckIns.length === 0 ? (
            <p className="dash-right-desc" style={{ marginTop: 8 }}>
              No check-ins yet. Use "I'm here" on any location to log a visit.
            </p>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentCheckIns.slice(0, 5).map((ci) => (
                <div key={ci.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--theme-bg)', border: '1px solid var(--theme-border)', borderRadius: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text)' }}>{ci.location?.name || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--theme-text-muted)', marginTop: 2 }}>
                      {new Date(ci.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {ci.location?.category ? ` · ${ci.location.category}` : ''}
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.75c-2.9 0-5.25 2.35-5.25 5.25 0 2.9 5.25 5.25 5.25 5.25s5.25-2.35 5.25-5.25c0-2.9-2.35-5.25-5.25-5.25z" stroke="var(--theme-accent)" strokeWidth="1.2" /><circle cx="7" cy="7" r="1.5" fill="var(--theme-accent)" /></svg>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
