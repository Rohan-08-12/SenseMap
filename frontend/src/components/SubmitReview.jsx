import { useState, useRef, useEffect } from 'react';
import { submitReview, analyzeReview } from '../services/api';
import api from '../services/api';

// ─── Slider row ──────────────────────────────────────────────────────────────
function SliderRow({ label, value, onChange, aiActive }) {
    return (
        <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--theme-text, #0f1720)' }}>
                    {label}
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--theme-text, #0f1720)' }}>
                        {value}/10
                    </span>
                    {aiActive && (
                        <span style={{
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'var(--theme-tag-soft, #dcfce7)',
                            border: '1px solid var(--theme-accent-soft, #bbf7d0)',
                            color: 'var(--theme-accent, #16a34a)',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                        }}>
                            ✦ AI
                        </span>
                    )}
                </div>
            </div>
            <input
                type="range"
                min="1"
                max="10"
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--theme-accent, #16a34a)', cursor: 'pointer' }}
            />
        </div>
    );
}

// ─── Multi-select pill group ──────────────────────────────────────────────────
// Same visual language as the existing "When did you visit?" pills, but allows
// multiple selections (toggled independently) instead of a single choice.
const FACILITIES_FIELDS = [
    { field: 'temperature', icon: '🌡️', label: 'Temperature & Airflow', options: ['Very cold', 'Cool', 'Comfortable', 'Warm', 'Hot', 'Good airflow', 'Stuffy'] },
    { field: 'seating', icon: '🪑', label: 'Seating', options: ['No seating', 'Limited seating', 'Plenty of seating', 'Soft/couch seating', 'Hard chairs only', 'Standing only'] },
    { field: 'bathrooms', icon: '🚻', label: 'Bathrooms', options: ['No public bathroom', 'Public bathroom available', 'Accessible bathroom', 'Single stall', 'Multiple stalls', 'Gendered', 'Unisex'] },
    { field: 'socialInteractions', icon: '👥', label: 'Social Interactions', options: ['Must speak to staff on entry', 'No interaction required', 'Electronic ordering available', 'Self-checkout available', 'Quiet/minimal staff interaction', 'Can browse freely without being approached'] },
];

function PillMultiSelect({ label, options, selected, onToggle }) {
    return (
        <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--theme-text, #0f1720)', marginBottom: 8 }}>
                {label} <span style={{ fontWeight: 400, color: 'var(--theme-text-muted, #6b7280)' }}>(optional)</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {options.map((opt) => {
                    const isSelected = selected.includes(opt);
                    return (
                        <button
                            key={opt}
                            type="button"
                            onClick={() => onToggle(opt)}
                            aria-pressed={isSelected}
                            style={{
                                padding: '8px 12px',
                                borderRadius: 20,
                                border: `1px solid ${isSelected ? 'var(--theme-accent)' : 'var(--theme-border)'}`,
                                background: isSelected ? 'var(--theme-accent)' : 'var(--theme-bg)',
                                color: isSelected ? '#fff' : 'var(--theme-text)',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Main component ──────────────────────────────────────────────────────────
/**
 * SubmitReview Component
 * Allows users to rate a location across different sensory dimensions (Noise, Lighting, Crowds).
 * Includes an option to upload an image to Cloudinary and an AI feature that analyzes
 * the review text to automatically suggest sensory scores.
 */
function SubmitReview({ location, onClose, onSubmitted }) {
    const [formData, setFormData] = useState({
        noiseLevel: 5,
        lightingLevel: 5,
        crowdLevel: 5,
        bodyText: '',
        rating: 5,
        visitTime: null,
        temperature: [],
        seating: [],
        bathrooms: [],
        socialInteractions: [],
    });
    const [submitting, setSubmitting] = useState(false);
    const [aiParsing, setAiParsing] = useState(false);

    const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth <= 768);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);
    const [aiResult, setAiResult] = useState(null);
    const [aiFilledFields, setAiFilledFields] = useState(new Set());
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    // ── Photo upload state ──────────────────────────────────────────────────
    const [photoFile, setPhotoFile] = useState(null);       // raw File object for preview
    const [photoPreview, setPhotoPreview] = useState(null); // object URL for <img>
    const [photoUrl, setPhotoUrl] = useState(null);         // Cloudinary URL after upload
    const [photoUploading, setPhotoUploading] = useState(false);
    const [photoError, setPhotoError] = useState(null);
    const fileInputRef = useRef(null);

    const handleChange = (field, value) => {
        setAiFilledFields((prev) => {
            const next = new Set(prev);
            next.delete(field);
            return next;
        });
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    // Toggles a single option within one of the multi-select facilities fields
    const toggleFacility = (field, option) => {
        setFormData((prev) => {
            const current = prev[field];
            const next = current.includes(option)
                ? current.filter((o) => o !== option)
                : [...current, option];
            return { ...prev, [field]: next };
        });
    };

    // ── Photo handlers ──────────────────────────────────────────────────────
    const handlePhotoSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Basic client-side validation
        if (!file.type.startsWith('image/')) {
            setPhotoError('Please select an image file.');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setPhotoError('Image must be under 5 MB.');
            return;
        }

        setPhotoFile(file);
        setPhotoPreview(URL.createObjectURL(file));
        setPhotoUrl(null);
        setPhotoError(null);
        setPhotoUploading(true);

        try {
            const formPayload = new FormData();
            formPayload.append('image', file);

            const res = await api.post('/upload', formPayload, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            // Backend returns { imageUrl: "https://res.cloudinary.com/..." }
            const uploadedUrl = res.data?.imageUrl;
            if (!uploadedUrl) throw new Error('Upload succeeded but no URL returned.');
            setPhotoUrl(uploadedUrl);
        } catch (err) {
            setPhotoError(err.response?.data?.message || err.message || 'Upload failed.');
            // Keep the preview so user can see what they tried to upload
        } finally {
            setPhotoUploading(false);
        }
    };

    const handleRemovePhoto = () => {
        if (photoPreview) URL.revokeObjectURL(photoPreview);
        setPhotoFile(null);
        setPhotoPreview(null);
        setPhotoUrl(null);
        setPhotoError(null);
        setPhotoUploading(false);
        // Reset the file input so the same file can be re-selected
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // ── AI analyze ──────────────────────────────────────────────────────────
    const handleAnalyze = () => {
        if (!formData.bodyText.trim()) return;
        setAiParsing(true);
        setAiResult(null);
        setAiFilledFields(new Set());

        analyzeReview(formData.bodyText)
            .then((res) => {
                const data = res.data;
                setAiResult(data);
                setAiParsing(false);

                if (data && !data.error) {
                    const filled = new Set();
                    setFormData((prev) => {
                        const next = { ...prev };
                        if (typeof data.noise_score === 'number') { next.noiseLevel = data.noise_score; filled.add('noiseLevel'); }
                        if (typeof data.lighting_score === 'number') { next.lightingLevel = data.lighting_score; filled.add('lightingLevel'); }
                        if (typeof data.crowd_score === 'number') { next.crowdLevel = data.crowd_score; filled.add('crowdLevel'); }
                        return next;
                    });
                    setAiFilledFields(filled);
                }
            })
            .catch(() => {
                setAiResult({ error: 'AI analysis unavailable — backend may be offline.' });
                setAiParsing(false);
            });
    };

    // ── Submit ───────────────────────────────────────────────────────────────
    const handleSubmit = (e) => {
        e.preventDefault();

        // Block submit if photo is mid-upload
        if (photoUploading) {
            setError('Please wait for the photo to finish uploading.');
            return;
        }

        const payload = {
            locationId: location?.id || location?.name || 'unknown',
            bodyText: formData.bodyText,
            rating: formData.rating,
            noiseLevel: formData.noiseLevel,
            lightingLevel: formData.lightingLevel,
            crowdLevel: formData.crowdLevel,
            ...(formData.visitTime && { visitTime: formData.visitTime }),
            ...(photoUrl && { imageUrl: photoUrl }),
            ...(formData.temperature.length > 0 && { temperature: formData.temperature }),
            ...(formData.seating.length > 0 && { seating: formData.seating }),
            ...(formData.bathrooms.length > 0 && { bathrooms: formData.bathrooms }),
            ...(formData.socialInteractions.length > 0 && { socialInteractions: formData.socialInteractions }),
        };

        setSubmitting(true);
        setError(null);

        submitReview(payload)
            .then(() => {
                setSuccess(true);
                setSubmitting(false);
                if (onSubmitted) onSubmitted();
            })
            .catch((err) => {
                setError(err.response?.data?.message || err.message);
                setSubmitting(false);
            });
    };

    const mobileStyle = {
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        width: '100%',
        height: '88vh',
        zIndex: 10001,
        background: 'var(--theme-surface, #ffffff)',
        color: 'var(--theme-text, #0f1720)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.18)',
        borderRadius: '20px 20px 0 0',
        borderTop: '1px solid var(--theme-border, #e5e7eb)',
    };
    const desktopStyle = {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 340,
        height: '100%',
        zIndex: 10000,
        background: 'var(--theme-surface, #ffffff)',
        color: 'var(--theme-text, #0f1720)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
        borderLeft: '1px solid var(--theme-border, #e5e7eb)',
    };

    return (
        <>
        {isMobile && (
            <div
                onClick={onClose}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.35)',
                    zIndex: 10000,
                }}
            />
        )}
        <div style={isMobile ? mobileStyle : desktopStyle}>

            {/* Mobile drag handle */}
            {isMobile && (
                <div style={{ width: 40, height: 4, background: 'rgba(0,0,0,0.15)', borderRadius: 2, margin: '14px auto 0', flexShrink: 0 }} />
            )}

            {/* Header */}
            <div style={{
                padding: isMobile ? '12px 20px 14px' : '18px 20px 14px',
                borderBottom: '1px solid var(--theme-border, #e5e7eb)',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                flexShrink: 0,
            }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--theme-text, #0f1720)' }}>
                        Submit Review
                    </h2>
                    {location?.name && (
                        <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--theme-text-muted, #6b7280)' }}>
                            For: {location.name}
                        </p>
                    )}
                </div>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none',
                        border: '1px solid var(--theme-border, #e5e7eb)',
                        borderRadius: 8,
                        width: 32,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: 'var(--theme-text-muted, #6b7280)',
                        fontSize: 16,
                        flexShrink: 0,
                        marginLeft: 12,
                    }}
                    aria-label="Close"
                >
                    ✕
                </button>
            </div>

            {/* Scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px', paddingBottom: isMobile ? 80 : 18 }}>
                {success ? (
                    <div style={{ textAlign: 'center', paddingTop: 48 }}>
                        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
                        <p style={{ fontWeight: 600, fontSize: 16, margin: '0 0 6px', color: 'var(--theme-text, #0f1720)' }}>
                            Review submitted!
                        </p>
                        <p style={{ fontSize: 13, color: 'var(--theme-text-muted, #6b7280)', margin: '0 0 24px' }}>
                            Thanks for helping the community.
                        </p>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '9px 24px', borderRadius: 8,
                                border: '1px solid var(--theme-border, #e5e7eb)',
                                background: 'transparent',
                                color: 'var(--theme-text, #0f1720)',
                                cursor: 'pointer', fontSize: 14, fontWeight: 500,
                            }}
                        >
                            Close
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>

                        <SliderRow label="Overall Rating" value={formData.rating} onChange={(v) => handleChange('rating', v)} aiActive={false} />
                        <SliderRow label="Noise Level" value={formData.noiseLevel} onChange={(v) => handleChange('noiseLevel', v)} aiActive={aiFilledFields.has('noiseLevel')} />
                        <SliderRow label="Lighting Level" value={formData.lightingLevel} onChange={(v) => handleChange('lightingLevel', v)} aiActive={aiFilledFields.has('lightingLevel')} />
                        <SliderRow label="Crowd Level" value={formData.crowdLevel} onChange={(v) => handleChange('crowdLevel', v)} aiActive={aiFilledFields.has('crowdLevel')} />

                        {/* Review text */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--theme-text, #0f1720)', marginBottom: 6 }}>
                                Your Review
                            </label>
                            <textarea
                                value={formData.bodyText}
                                onChange={(e) => handleChange('bodyText', e.target.value)}
                                placeholder="Describe the sensory environment..."
                                rows={4}
                                style={{
                                    width: '100%', padding: '10px 12px',
                                    borderRadius: 8,
                                    border: '1px solid var(--theme-border, #e5e7eb)',
                                    background: 'var(--theme-bg, #f9fafb)',
                                    color: 'var(--theme-text, #0f1720)',
                                    fontSize: 13, lineHeight: 1.5,
                                    resize: 'vertical', outline: 'none',
                                    boxSizing: 'border-box', fontFamily: 'inherit',
                                }}
                            />
                        </div>

                        {/* Visit Time Selector */}
                        <div style={{ marginBottom: 18 }}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--theme-text, #0f1720)', marginBottom: 8 }}>
                                When did you visit? <span style={{ fontWeight: 400, color: 'var(--theme-text-muted, #6b7280)' }}>(optional)</span>
                            </label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {[
                                    { id: 'morning', label: 'Morning', time: '6am–12pm' },
                                    { id: 'afternoon', label: 'Afternoon', time: '12pm–5pm' },
                                    { id: 'evening', label: 'Evening', time: '5pm–9pm' },
                                    { id: 'night', label: 'Night', time: '9pm+' },
                                ].map((opt) => (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => handleChange('visitTime', formData.visitTime === opt.id ? null : opt.id)}
                                        style={{
                                            flex: '1 1 calc(50% - 4px)',
                                            padding: '10px 4px',
                                            borderRadius: 20,
                                            border: `1px solid ${formData.visitTime === opt.id ? 'var(--theme-accent)' : 'var(--theme-border)'}`,
                                            background: formData.visitTime === opt.id ? 'var(--theme-accent)' : 'var(--theme-bg)',
                                            color: formData.visitTime === opt.id ? '#fff' : 'var(--theme-text)',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: 2,
                                        }}
                                    >
                                        <span>{opt.label}</span>
                                        <span style={{ 
                                            fontSize: 10, 
                                            fontWeight: 400, 
                                            opacity: formData.visitTime === opt.id ? 0.9 : 0.6 
                                        }}>
                                            {opt.time}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Facilities pill selectors */}
                        {FACILITIES_FIELDS.map(({ field, icon, label, options }) => (
                            <PillMultiSelect
                                key={field}
                                label={`${icon} ${label}`}
                                options={options}
                                selected={formData[field]}
                                onToggle={(opt) => toggleFacility(field, opt)}
                            />
                        ))}

                        {/* Analyze with AI */}
                        <button
                            type="button"
                            onClick={handleAnalyze}
                            disabled={aiParsing || !formData.bodyText.trim()}
                            style={{
                                width: '100%', padding: '9px 0', borderRadius: 8,
                                border: '1px solid var(--theme-border, #e5e7eb)',
                                background: 'var(--theme-tag-soft, #f3f4f6)',
                                color: (aiParsing || !formData.bodyText.trim())
                                    ? 'var(--theme-text-muted, #9ca3af)'
                                    : 'var(--theme-text, #0f1720)',
                                cursor: (aiParsing || !formData.bodyText.trim()) ? 'not-allowed' : 'pointer',
                                fontSize: 13, fontWeight: 500, marginBottom: 12,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}
                        >
                            <span>🤖</span>
                            {aiParsing ? 'Analyzing...' : 'Analyze with AI'}
                        </button>

                        {/* AI result card */}
                        {aiResult && !aiResult.error && (
                            <div style={{
                                background: 'var(--theme-tag-soft, #f0fdf4)',
                                border: '1px solid var(--theme-border, #bbf7d0)',
                                borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13,
                            }}>
                                <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.06em', color: 'var(--theme-accent, #16a34a)', marginBottom: 5 }}>
                                    ✦ AI ANALYSIS
                                </div>
                                {aiResult.summary && (
                                    <p style={{ margin: '0 0 8px', color: 'var(--theme-text, #0f1720)', lineHeight: 1.5 }}>
                                        {aiResult.summary}
                                    </p>
                                )}
                                {aiResult.tags?.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                                        {aiResult.tags.map((tag) => (
                                            <span key={tag} style={{
                                                padding: '2px 8px', borderRadius: 20,
                                                background: 'var(--theme-tag-strong, #dcfce7)',
                                                fontSize: 11, color: 'var(--theme-text-muted, #374151)', fontWeight: 500,
                                            }}>
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <p style={{ margin: 0, fontSize: 11, color: 'var(--theme-text-muted, #6b7280)' }}>
                                    Sliders updated — adjust any value if needed.
                                </p>
                            </div>
                        )}

                        {aiResult?.error && (
                            <div style={{
                                background: '#fef2f2', border: '1px solid #fecaca',
                                borderRadius: 8, padding: '10px 12px', marginBottom: 14,
                                fontSize: 13, color: '#dc2626',
                            }}>
                                {aiResult.error}
                            </div>
                        )}

                        {/* ── Photo upload ──────────────────────────────────────────────── */}
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--theme-text, #0f1720)', marginBottom: 6 }}>
                                Photo <span style={{ fontWeight: 400, color: 'var(--theme-text-muted, #6b7280)' }}>(optional)</span>
                            </label>

                            {/* Hidden native file input */}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handlePhotoSelect}
                                style={{ display: 'none' }}
                                aria-label="Upload photo"
                            />

                            {!photoPreview ? (
                                /* Upload trigger button */
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    style={{
                                        width: '100%',
                                        padding: '28px 0',
                                        borderRadius: 8,
                                        border: '1.5px dashed var(--theme-border, #d1d5db)',
                                        background: 'var(--theme-bg, #f9fafb)',
                                        color: 'var(--theme-text-muted, #6b7280)',
                                        cursor: 'pointer',
                                        fontSize: 13,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: 6,
                                        transition: 'border-color 0.15s, background 0.15s',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--theme-accent, #16a34a)';
                                        e.currentTarget.style.background = 'var(--theme-tag-soft, #f0fdf4)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'var(--theme-border, #d1d5db)';
                                        e.currentTarget.style.background = 'var(--theme-bg, #f9fafb)';
                                    }}
                                >
                                    <span style={{ fontSize: 20 }}>📷</span>
                                    <span>Add a photo</span>
                                </button>
                            ) : (
                                /* Preview card */
                                <div style={{
                                    position: 'relative',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    border: '1px solid var(--theme-border, #e5e7eb)',
                                }}>
                                    <img
                                        src={photoPreview}
                                        alt="Preview"
                                        style={{
                                            width: '100%',
                                            height: 160,
                                            objectFit: 'cover',
                                            display: 'block',
                                        }}
                                    />

                                    {/* Upload status overlay */}
                                    {photoUploading && (
                                        <div style={{
                                            position: 'absolute',
                                            inset: 0,
                                            background: 'rgba(255,255,255,0.75)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 8,
                                            fontSize: 13,
                                            fontWeight: 600,
                                            color: 'var(--theme-text, #0f1720)',
                                        }}>
                                            <span style={{
                                                display: 'inline-block',
                                                width: 16,
                                                height: 16,
                                                border: '2px solid var(--theme-accent, #16a34a)',
                                                borderTopColor: 'transparent',
                                                borderRadius: '50%',
                                                animation: 'spin 0.7s linear infinite',
                                            }} />
                                            Uploading…
                                        </div>
                                    )}

                                    {/* Success tick */}
                                    {photoUrl && !photoUploading && (
                                        <div style={{
                                            position: 'absolute',
                                            top: 8,
                                            left: 8,
                                            background: 'var(--theme-accent, #16a34a)',
                                            borderRadius: 4,
                                            padding: '2px 7px',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            color: '#fff',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 4,
                                        }}>
                                            ✓ Uploaded
                                        </div>
                                    )}

                                    {/* Remove button */}
                                    <button
                                        type="button"
                                        onClick={handleRemovePhoto}
                                        aria-label="Remove photo"
                                        style={{
                                            position: 'absolute',
                                            top: 8,
                                            right: 8,
                                            width: 26,
                                            height: 26,
                                            borderRadius: '50%',
                                            border: 'none',
                                            background: 'rgba(0,0,0,0.55)',
                                            color: '#fff',
                                            fontSize: 13,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            lineHeight: 1,
                                        }}
                                    >
                                        ✕
                                    </button>

                                    {/* File name strip */}
                                    <div style={{
                                        padding: '6px 10px',
                                        background: 'var(--theme-bg, #f9fafb)',
                                        borderTop: '1px solid var(--theme-border, #e5e7eb)',
                                        fontSize: 11,
                                        color: 'var(--theme-text-muted, #6b7280)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}>
                                        {photoFile?.name}
                                    </div>
                                </div>
                            )}

                            {/* Photo-specific error */}
                            {photoError && (
                                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#dc2626' }}>
                                    {photoError}
                                </p>
                            )}
                        </div>

                        {/* Submit button */}
                        <button
                            type="submit"
                            disabled={submitting || photoUploading}
                            style={{
                                width: '100%', padding: '11px 0', borderRadius: 8, border: 'none',
                                background: (submitting || photoUploading)
                                    ? 'var(--theme-text-muted, #9ca3af)'
                                    : 'var(--theme-accent, #16a34a)',
                                color: '#fff', fontSize: 15, fontWeight: 600,
                                cursor: (submitting || photoUploading) ? 'not-allowed' : 'pointer',
                            }}
                        >
                            {submitting ? 'Submitting...' : photoUploading ? 'Uploading photo…' : 'Submit Review'}
                        </button>

                        {error && (
                            <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>
                                Error: {error}
                            </div>
                        )}
                    </form>
                )}
            </div>
        </div>
        </>
    );
}

export default SubmitReview;