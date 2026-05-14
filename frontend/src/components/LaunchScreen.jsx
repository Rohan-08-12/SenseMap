import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTheme } from '../theme/ThemeContext.jsx';
import LogoutConfirmation from './LogoutConfirmation';
import LegalModal from './LegalModal';
import './LaunchScreen.css';

const CATEGORIES = [
    {
        emoji: '📚',
        title: 'Quiet Spaces',
        desc: 'Spaces with very low noise scores — libraries, reading rooms, and calm indoor venues.',
        tags: ['Low Noise', 'Focused'],
        filter: 'quiet-now',
    },
    {
        emoji: '💡',
        title: 'Soft-Light Spots',
        desc: 'Venues prioritizing natural or warm lighting over harsh fluorescents.',
        tags: ['Warm Light', 'Cozy'],
        filter: 'soft-lighting',
    },
    {
        emoji: '🌳',
        title: 'Calm Parks',
        desc: 'Open outdoor areas away from heavy traffic with plenty of personal space.',
        tags: ['Open Space', 'Nature'],
        filter: 'outdoor',
    },
    {
        emoji: '👥',
        title: 'Low-Crowd Places',
        desc: 'Venues rated low on crowd density — easy to move through without sensory overload.',
        tags: ['Low Density', 'Spacious'],
        filter: 'low-crowds',
    },
    {
        emoji: '🌅',
        title: 'Before-Noon Spots',
        desc: 'Places that are quieter and less crowded in the morning hours.',
        tags: ['Morning', 'Calm'],
        filter: 'before-noon',
    },
    {
        emoji: '🔍',
        title: 'Explore All Nearby',
        desc: 'View the full sensory map with AI insights for places around you.',
        tags: ['Highly Recommended'],
        highlight: true,
        filter: null,
    },
];

const POPULAR_TAGS = [
    { emoji: '🤫', label: 'Quiet spaces', filter: 'quiet-now' },
    { emoji: '💡', label: 'Soft lighting', filter: 'soft-lighting' },
    { emoji: '👥', label: 'Low crowds', filter: 'low-crowds' },
    { emoji: '🌿', label: 'Outdoor areas', filter: 'outdoor' },
];

const categoryContainerVariants = {
    hidden: { opacity: 0 },
    visible: (reducedMotion) => ({
        opacity: 1,
        transition: {
            staggerChildren: reducedMotion ? 0 : 0.1,
            delayChildren: reducedMotion ? 0 : 0.25,
        },
    }),
};

const categoryCardVariants = (reducedMotion) => ({
    hidden: {
        opacity: reducedMotion ? 1 : 0,
        y: reducedMotion ? 0 : 24,
        scale: reducedMotion ? 1 : 0.96,
    },
    visible: {
        opacity: 1,
        y: 0,
        scale: 1,
        transition: {
            duration: reducedMotion ? 0 : 0.5,
            ease: [0.22, 0.61, 0.36, 1],
        },
    },
});

function LaunchScreen({ onExploreMap, onLogin, onLogout }) {
    const { isAuthenticated, user } = useAuth0();
    const [searchQuery, setSearchQuery] = useState('');
    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [legalModal, setLegalModal] = useState(null);
    const prefersReducedMotion = useReducedMotion();
    const { theme, setTheme } = useTheme();

    const handleNavigate = (filter = null, query = '') => {
        if (onExploreMap) {
            onExploreMap({ filter, searchQuery: query || searchQuery });
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        handleNavigate(null, searchQuery);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleSearch(e);
    };

    return (
        <div className="launch">
            <header className="launch-header">
                <div className="launch-logo">
                    <div className="launch-logo-icon">
                        <img src="/favicon.png" alt="" />
                    </div>
                    <div className="launch-logo-text">
                        <h1>SenseMap</h1>
                        <p>Explore safely and simply</p>
                    </div>
                </div>
                <div className="launch-theme-switcher" role="group" aria-label="Theme">
                    {['nature', 'calm'].map((t) => (
                        <button
                            key={t}
                            type="button"
                            className={`launch-theme-btn launch-theme-btn--text ${theme === t ? 'active' : ''}`}
                            onClick={() => setTheme(t)}
                            aria-pressed={theme === t}
                            aria-label={`${t.charAt(0).toUpperCase() + t.slice(1)} theme`}
                            title={t === 'calm' ? 'Calm (blue/teal)' : 'Nature (green/beige)'}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="launch-auth">
                    {!isAuthenticated ? (
                        <>
                            <button className="btn-login" onClick={() => onLogin()}>
                                Log in
                            </button>
                            <button className="btn-signup" onClick={() => onLogin()}>
                                Sign up
                            </button>
                        </>
                    ) : (
                        <div className="launch-user">
                            <span className="launch-user-name">{user?.name || user?.email}</span>
                            <button className="btn-signup" onClick={() => handleNavigate()}>
                                Open Map
                            </button>
                            <button className="btn-login" onClick={() => setShowLogoutModal(true)}>
                                Log out
                            </button>
                        </div>
                    )}
                </div>
            </header>

            <div className="launch-bg">
                <section className="launch-hero">
                    <motion.div
                        className="launch-badge"
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                        animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                        transition={prefersReducedMotion ? undefined : { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
                    >
                        ✨ A calmer way to explore
                    </motion.div>

                    <motion.h2
                        className="launch-heading"
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                        animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                        transition={prefersReducedMotion ? undefined : { duration: 0.45, delay: 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
                    >
                        Find places that feel right for you.
                    </motion.h2>

                    <motion.p
                        className="launch-subheading"
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
                        animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0 }}
                        transition={prefersReducedMotion ? undefined : { duration: 0.45, delay: 0.12, ease: [0.25, 0.46, 0.45, 0.94] }}
                    >
                        Discover public spaces with sensory comfort insights before you go.
                    </motion.p>


                    <motion.div
                        className="launch-map-card"
                        onClick={() => handleNavigate()}
                        role="button"
                        tabIndex={0}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
                        animate={prefersReducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
                        transition={prefersReducedMotion ? undefined : { duration: 0.5, delay: 0.2, ease: [0.22, 0.55, 0.34, 0.99] }}
                    >
                        <div className="launch-map-preview">
                            <img className="map-bg" src="/assets/images/map-preview.jpg" alt="Sensory map preview" />
                            <div className="map-overlay" />

                            <div className="map-nearby-badge">
                                🗺️ Nearby map
                            </div>

                            <div className="map-legend">
                                <div className="map-legend-item">
                                    <span className="legend-dot green" />
                                    Comfortable
                                </div>
                                <div className="map-legend-item">
                                    <span className="legend-dot yellow" />
                                    Moderate
                                </div>
                                <div className="map-legend-item">
                                    <span className="legend-dot red" />
                                    Overwhelming
                                </div>
                            </div>

                            <form className="map-search" onSubmit={handleSearch} onClick={(e) => e.stopPropagation()}>
                                <div className="map-search-input">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                                    <input
                                        type="text"
                                        placeholder="Search places, needs, or triggers"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                    />
                                </div>
                                <button type="submit" className="map-search-btn">
                                    Search
                                </button>
                            </form>
                        </div>
                    </motion.div>

                    <div className="launch-popular">
                        <span className="popular-label">Popular:</span>
                        {POPULAR_TAGS.map((tag) => (
                            <button
                                key={tag.filter}
                                className="popular-tag"
                                onClick={() => handleNavigate(tag.filter)}
                            >
                                <span>{tag.emoji}</span>
                                {tag.label}
                            </button>
                        ))}
                    </div>
                </section>

                <motion.section
                    className="launch-categories"
                    aria-label="Sensory-friendly categories"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.4 }}
                >
                    <motion.h2
                        className="cat-heading"
                        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 12, scale: prefersReducedMotion ? 1 : 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: prefersReducedMotion ? 0 : 0.55, ease: [0.22, 0.61, 0.36, 1] }}
                    >
                        Top Sensory-Friendly Categories
                    </motion.h2>
                    <motion.p
                        className="cat-subtitle"
                        initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: prefersReducedMotion ? 0 : 0.5, delay: prefersReducedMotion ? 0 : 0.08, ease: [0.22, 0.61, 0.36, 1] }}
                    >
                        Explore highly-rated spaces tailored for comfort.
                    </motion.p>

                    <motion.div
                        className="cat-grid"
                        variants={categoryContainerVariants}
                        initial="hidden"
                        animate="visible"
                        custom={!!prefersReducedMotion}
                    >
                        {CATEGORIES.map((cat) => (
                            <motion.div
                                key={cat.title}
                                className={`cat-card${cat.highlight ? ' cat-card--highlight' : ''}`}
                                variants={categoryCardVariants(!!prefersReducedMotion)}
                                whileHover={prefersReducedMotion ? undefined : {
                                    y: -6,
                                    transition: { duration: 0.3, ease: [0.22, 0.61, 0.36, 1] },
                                }}
                                whileTap={prefersReducedMotion ? undefined : {
                                    scale: 0.98,
                                    transition: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] },
                                }}
                                onClick={() => handleNavigate(cat.filter)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => e.key === 'Enter' && handleNavigate(cat.filter)}
                                aria-label={`${cat.title}: ${cat.desc}`}
                            >
                                <div className="cat-icon">
                                    <span style={{ fontSize: 24 }} aria-hidden>{cat.emoji}</span>
                                </div>
                                <div className="cat-card-content">
                                    <h3>{cat.title}</h3>
                                    <p>{cat.desc}</p>
                                    <div className="cat-tags">
                                        {cat.tags.map((tag) => (
                                            <span key={tag} className={`cat-tag${cat.highlight ? ' highlight' : ''}`}>
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </motion.div>
                </motion.section>
            </div>

            <footer className="launch-footer">
                <button className="launch-legal-link" onClick={() => setLegalModal('privacy')}>Privacy Policy</button>
                <span>·</span>
                <button className="launch-legal-link" onClick={() => setLegalModal('terms')}>Terms of Use</button>
            </footer>

            {showLogoutModal && (
                <LogoutConfirmation
                    onCancel={() => setShowLogoutModal(false)}
                    onLogout={onLogout}
                />
            )}

            {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
        </div>
    );
}

export default LaunchScreen;
