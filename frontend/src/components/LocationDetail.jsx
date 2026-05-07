import { useState, useEffect } from 'react';
import { getReviewsByLocation, getAIInsights } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import './LocationDetail.css';
function LocationDetail({ location, onClose }) {
    const [reviews, setReviews] = useState([]);
    const [aiInsight, setAiInsight] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!location) return;

        setLoading(true);
        setError(null);

        // Fetch reviews + AI insights in parallel
        const locationId = location.id || location.locationId || location.googlePlaceId || location.osmId || location.name; // ensure we grab the real ID first

        Promise.allSettled([
            getReviewsByLocation(locationId),
            getAIInsights(locationId),
        ])
            .then(([reviewsResult, insightsResult]) => {
                if (reviewsResult.status === 'fulfilled') {
                    const data = reviewsResult.value.data;
                    setReviews(Array.isArray(data) ? data : data?.reviews || []);
                } else {
                    console.warn('[LocationDetail] Reviews fetch failed:', reviewsResult.reason?.message);
                }

                if (insightsResult.status === 'fulfilled') {
                    setAiInsight(insightsResult.value.data);
                } else {
                    console.warn('[LocationDetail] AI Insights fetch failed:', insightsResult.reason?.message);
                }

                setLoading(false);
            })
            .catch((err) => {
                console.error('[LocationDetail] Unexpected error:', err);
                setError(err.message);
                setLoading(false);
            });
    }, [location]);

    if (!location) return null;

    // Mock data for the "Noise through the day" line chart to match mockup visually
    const mockChartData = [
        { time: 'Morning', value1: 1.5, value2: 3.5 },
        { time: '10am', value1: 2.0, value2: 3.2 },
        { time: 'Noon', value1: 2.8, value2: 2.5 },
        { time: '4pm', value1: 3.2, value2: 1.8 },
        { time: 'Evening', value1: 4.0, value2: 1.0 },
    ];

    const noiseScore = location.noise_score ?? location.noiseScore;
    const noiseLabel = noiseScore > 3.5 ? 'Loud' : noiseScore > 2.5 ? 'Medium' : noiseScore ? 'Quiet' : '–';
    const isUnverified = !loading && reviews.length === 0;

    return (
        <div className="location-detail-panel">
            <button className="ld-close-btn" onClick={onClose}>✕</button>

            <div className="ld-image-placeholder">
                {location.name}
            </div>

            <div className="ld-header-row">
                <div className="ld-title-block">
                    <h2>{location.name}</h2>
                    <div className="ld-review-status">
                        {isUnverified ? 'No reviews yet' : `${reviews.length} reviews`}
                    </div>
                </div>
                <div className="ld-actions">
                    <button className="ld-btn-profile">Set up profile</button>
                    <button className="ld-btn-save">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M4 2v12l4-2 4 2V2z" strokeWidth="1.5"/></svg>
                        Save place
                    </button>
                    <button
                        onClick={() =>
                            window.open(
                                `https://www.google.com/maps/dir/?api=1&destination=${location.lat || location.latitude},${location.lng || location.longitude}`,
                                '_blank'
                            )
                        }
                        className="ld-action-btn"
                    >
                        Get Directions
                    </button>
                </div>
            </div>

            <div className="ld-metrics-grid">
                <div className={`ld-metric-card ${isUnverified ? 'unverified' : ''}`}>
                    <div className="ld-metric-label">Comfort</div>
                    <div className="ld-metric-value">{location.comfort_score ?? location.comfortScore ?? '–'}</div>
                </div>
                <div className={`ld-metric-card ${isUnverified ? 'unverified' : ''}`}>
                    <div className="ld-metric-label">Noise</div>
                    <div className="ld-metric-value">{noiseLabel}</div>
                </div>
                <div className={`ld-metric-card ${isUnverified ? 'unverified' : ''}`}>
                    <div className="ld-metric-label">Best time</div>
                    <div className="ld-metric-value">
                        {aiInsight?.bestTime?.includes('Morning') ? 'Morning' : 
                         aiInsight?.bestTime?.includes('Evening') ? 'Evening' : 
                         aiInsight?.bestTime?.includes('Afternoon') ? 'Afternoon' : 'Morning'}
                    </div>
                </div>
            </div>

            <div className="ld-tags-row">
                <span className="ld-tag neutral">Sensory-friendly</span>
                {!isUnverified && <span className="ld-tag positive">56% would revisit</span>}
            </div>

            <div className="ld-section-card">
                <h3 className="ld-section-title">Noise through the day</h3>
                <p className="ld-section-subtitle">Based on sensory scores for this location.</p>
                
                <div className="ld-chart-container">
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={mockChartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                            <XAxis dataKey="time" axisLine={{ stroke: '#ccc' }} tickLine={{ stroke: '#ccc' }} tick={{fontSize: 12, fill: '#888'}} />
                            <YAxis domain={[0, 5]} ticks={[0, 2, 5]} axisLine={{ stroke: '#ccc' }} tickLine={{ stroke: '#ccc' }} tick={{fontSize: 12, fill: '#888'}} />
                            <Line type="monotone" dataKey="value1" stroke="#fca5a5" strokeWidth={2.5} dot={false} />
                            <Line type="monotone" dataKey="value2" stroke="#5eead4" strokeWidth={2.5} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="ld-section-card">
                <h3 className="ld-section-title">AI insight</h3>
                <p className="ld-section-subtitle">Only the most important signals are shown.</p>
                
                {isUnverified ? (
                     <div className="ld-empty-state">
                         AI insights will appear once this place has been visited.
                     </div>
                ) : (
                    <div className="ld-insight-text">
                        {loading && <div>Loading insights...</div>}
                        {!loading && !location.ai_summary && !aiInsight && (
                            <div style={{ color: '#888' }}>No AI insights available yet.</div>
                        )}
                        {location.ai_summary && (
                            <div style={{ marginBottom: 8 }}>{location.ai_summary}</div>
                        )}
                        {aiInsight && !aiInsight.error && (
                            <>
                                {aiInsight.noise && <div style={{ marginBottom: 4 }}><strong>Noise:</strong> {aiInsight.noise.summary}</div>}
                                {aiInsight.lighting && <div style={{ marginBottom: 4 }}><strong>Lighting:</strong> {aiInsight.lighting.summary}</div>}
                                {aiInsight.crowd && <div style={{ marginBottom: 4 }}><strong>Crowds:</strong> {aiInsight.crowd.summary}</div>}
                            </>
                        )}
                        {aiInsight?.error && (
                            <div style={{ color: '#f88', marginTop: 8 }}>{aiInsight.error}</div>
                        )}
                    </div>
                )}
            </div>

            {/* Community Reviews Card */}
            <div className="ld-section-card" style={{ marginBottom: 40 }}>
                <h3 className="ld-section-title">Community Reviews</h3>
                {loading && <div className="ld-insight-text">Loading reviews...</div>}
                
                {reviews.length > 0 ? (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {reviews.map((review, i) => (
                            <div key={review.id || i} style={{ paddingBottom: 12, borderBottom: i < reviews.length - 1 ? '1px solid #eee' : 'none' }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#222', marginBottom: 2 }}>
                                    {review.user || 'Anonymous'}
                                </div>
                                <div style={{ fontSize: 13, color: '#444', lineHeight: 1.4 }}>
                                    {review.bodyText || review.text || review.review_text}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    !loading && <div className="ld-empty-state">No reviews yet. Be the first to check in!</div>
                )}
            </div>

            {error && <div style={{ color: 'red', marginTop: 12 }}>Error: {error}</div>}
        </div>
    );
}

export default LocationDetail;
