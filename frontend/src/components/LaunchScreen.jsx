import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTheme } from '../theme/ThemeContext.jsx';
import LogoutConfirmation from './LogoutConfirmation';
import LegalModal from './LegalModal';
import './LaunchScreen.css';

function getQuizResult(noise, light, crowd) {
    const avg = ((noise ?? 3) + (light ?? 3) + (crowd ?? 3)) / 3;
    if (avg <= 2) return { type: 'Sanctuary Seeker', emoji: '🌿', places: 'quiet libraries, small gardens, and calm cafes' };
    if (avg <= 3.5) return { type: 'Balanced Explorer', emoji: '✨', places: 'neighbourhood parks, bookshops, and low-key cafes' };
    return { type: 'Flexible Adventurer', emoji: '🗺️', places: 'most public spaces, local markets, and busy venues' };
}

const QUIZ_QUESTIONS = [
    {
        key: 'noise',
        label: 'Noise sensitivity',
        question: 'How sensitive are you to noise?',
        options: [
            { value: 1, label: 'Very sensitive', sub: 'I need quiet spaces', accent: '#5a8f6e' },
            { value: 3, label: 'Somewhat sensitive', sub: 'Some noise is okay', accent: '#c9944a' },
            { value: 5, label: 'Not sensitive', sub: 'Noise is no issue', accent: '#5b9bd5' },
        ],
        preview: {
            heading: 'Noise-sensitive picks',
            desc: 'Places our community rates quietest',
            places: ['Public libraries', 'Small gardens', 'Quiet cafes', 'Reading rooms'],
        },
    },
    {
        key: 'light',
        label: 'Light sensitivity',
        question: 'How do bright lights affect you?',
        options: [
            { value: 1, label: 'Prefer soft light', sub: 'Bright lights are too much', accent: '#5a8f6e' },
            { value: 3, label: 'Usually fine', sub: 'Most lighting is okay', accent: '#c9944a' },
            { value: 5, label: 'No issue', sub: 'Bright light is fine', accent: '#5b9bd5' },
        ],
        preview: {
            heading: 'Soft-light spaces',
            desc: 'Venues with natural or warm lighting',
            places: ['Independent bookshops', 'Plant cafes', 'Small galleries', 'Evening parks'],
        },
    },
    {
        key: 'crowd',
        label: 'Crowd sensitivity',
        question: 'How are you with crowded spaces?',
        options: [
            { value: 1, label: 'Need empty spaces', sub: 'Crowds are overwhelming', accent: '#5a8f6e' },
            { value: 3, label: 'A few people', sub: 'Small groups are okay', accent: '#c9944a' },
            { value: 5, label: 'Crowds are fine', sub: 'Busy places are no problem', accent: '#5b9bd5' },
        ],
        preview: {
            heading: 'Low-crowd spaces',
            desc: 'Places rated least crowded by visitors',
            places: ['Early morning parks', 'Small museums', 'Neighbourhood cafes', 'Quiet side streets'],
        },
    },
];

const quizSlideVariants = {
    enter: (dir) => ({ x: dir * 40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir * -40, opacity: 0 }),
};

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
    const [quizStep, setQuizStep] = useState(0);
    const [quizAnswers, setQuizAnswers] = useState({});
    const [quizDir, setQuizDir] = useState(1);
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

    const handleQuizAnswer = (key, value) => {
        setQuizAnswers((prev) => ({ ...prev, [key]: value }));
        setQuizDir(1);
        setQuizStep((s) => s + 1);
    };

    const handleQuizBack = () => {
        setQuizDir(-1);
        setQuizStep((s) => s - 1);
    };

    const handleQuizReset = () => {
        setQuizAnswers({});
        setQuizDir(-1);
        setQuizStep(0);
    };

    const currentQuestion = quizStep >= 1 && quizStep <= 3 ? QUIZ_QUESTIONS[quizStep - 1] : null;
    const quizResult = quizStep === 4 ? getQuizResult(quizAnswers.noise, quizAnswers.light, quizAnswers.crowd) : null;

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

                {/* ── Sensory Profile Demo ── */}
                <section className="launch-quiz-section">
                    <div className="quiz-shell">
                        {/* Left: question */}
                        <div className="quiz-left">
                            <div className="quiz-progress-track" aria-hidden="true">
                                <motion.div
                                    className="quiz-progress-fill"
                                    animate={{ width: `${(Math.min(quizStep, 3) / 3) * 100}%` }}
                                    transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                                />
                            </div>

                            <AnimatePresence mode="wait" custom={quizDir}>
                                {quizStep === 0 && (
                                    <motion.div key="qi" className="quiz-pane"
                                        custom={quizDir} variants={prefersReducedMotion ? {} : quizSlideVariants}
                                        initial="enter" animate="center" exit="exit"
                                        transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                                    >
                                        <p className="quiz-eyebrow">No account needed</p>
                                        <h2 className="quiz-heading">What kind of spaces suit you?</h2>
                                        <p className="quiz-sub">Answer 3 questions. See exactly how SenseMap personalises your map.</p>
                                        <motion.button className="quiz-start-btn"
                                            onClick={() => { setQuizDir(1); setQuizStep(1); }}
                                            whileHover={prefersReducedMotion ? undefined : { scale: 1.02 }}
                                            whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                                        >
                                            Start →
                                        </motion.button>
                                    </motion.div>
                                )}

                                {quizStep >= 1 && quizStep <= 3 && currentQuestion && (
                                    <motion.div key={`qq${quizStep}`} className="quiz-pane"
                                        custom={quizDir} variants={prefersReducedMotion ? {} : quizSlideVariants}
                                        initial="enter" animate="center" exit="exit"
                                        transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                                    >
                                        <p className="quiz-eyebrow">Step {quizStep} of 3 — {currentQuestion.label}</p>
                                        <h2 className="quiz-heading">{currentQuestion.question}</h2>
                                        <div className="quiz-options">
                                            {currentQuestion.options.map((opt) => (
                                                <motion.button
                                                    key={opt.value}
                                                    className="quiz-option-btn"
                                                    style={{ '--opt-accent': opt.accent }}
                                                    onClick={() => handleQuizAnswer(currentQuestion.key, opt.value)}
                                                    whileHover={prefersReducedMotion ? undefined : { x: 3 }}
                                                    whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}
                                                    transition={{ duration: 0.14 }}
                                                >
                                                    <span className="quiz-opt-bar" />
                                                    <div className="quiz-opt-text">
                                                        <strong>{opt.label}</strong>
                                                        <span>{opt.sub}</span>
                                                    </div>
                                                    <span className="quiz-opt-chevron" aria-hidden="true">›</span>
                                                </motion.button>
                                            ))}
                                        </div>
                                        {quizStep > 1 && (
                                            <button className="quiz-back" onClick={handleQuizBack}>← Back</button>
                                        )}
                                    </motion.div>
                                )}

                                {quizStep === 4 && quizResult && (
                                    <motion.div key="qr" className="quiz-pane"
                                        custom={quizDir} variants={prefersReducedMotion ? {} : quizSlideVariants}
                                        initial="enter" animate="center" exit="exit"
                                        transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                                    >
                                        <p className="quiz-eyebrow">Your sensory profile</p>
                                        <h2 className="quiz-heading">{quizResult.type}</h2>
                                        <p className="quiz-sub">SenseMap would surface <strong>{quizResult.places}</strong> near you — comfort-scored to your exact tolerances.</p>
                                        {!isAuthenticated ? (
                                            <button className="quiz-start-btn" onClick={() => onLogin()}>
                                                See your real map →
                                            </button>
                                        ) : (
                                            <button className="quiz-start-btn" onClick={() => handleNavigate()}>
                                                Open my map →
                                            </button>
                                        )}
                                        <button className="quiz-back" onClick={handleQuizReset}>Try again</button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Right: live preview */}
                        <div className="quiz-right">
                            <AnimatePresence mode="wait">
                                {quizStep === 0 && (
                                    <motion.div key="pr0" className="quiz-preview-pane"
                                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                        transition={{ duration: 0.25 }}
                                    >
                                        <p className="preview-label">What you unlock</p>
                                        <div className="preview-feature-list">
                                            {[
                                                { num: '01', text: 'Personal comfort % for every place' },
                                                { num: '02', text: 'AI sensory summary before you visit' },
                                                { num: '03', text: 'Saved favourites & visit history' },
                                            ].map((f) => (
                                                <div key={f.num} className="preview-feature-row">
                                                    <span className="preview-feature-num">{f.num}</span>
                                                    <span className="preview-feature-text">{f.text}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}

                                {quizStep >= 1 && quizStep <= 3 && currentQuestion && (
                                    <motion.div key={`pr${quizStep}`} className="quiz-preview-pane"
                                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                                        transition={{ duration: 0.28 }}
                                    >
                                        <p className="preview-label">{currentQuestion.preview.heading}</p>
                                        <p className="preview-desc">{currentQuestion.preview.desc}</p>
                                        <div className="preview-chips">
                                            {currentQuestion.preview.places.map((place, i) => (
                                                <motion.div key={place} className="preview-chip"
                                                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: i * 0.06, duration: 0.22 }}
                                                >
                                                    {place}
                                                </motion.div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}

                                {quizStep === 4 && quizResult && (
                                    <motion.div key="pr4" className="quiz-preview-pane"
                                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                                        transition={{ duration: 0.25 }}
                                    >
                                        <p className="preview-label">Your tolerances</p>
                                        <div className="quiz-bars">
                                            {[
                                                { label: 'Noise', value: quizAnswers.noise ?? 3 },
                                                { label: 'Lighting', value: quizAnswers.light ?? 3 },
                                                { label: 'Crowds', value: quizAnswers.crowd ?? 3 },
                                            ].map((bar) => (
                                                <div key={bar.label} className="quiz-bar-row">
                                                    <span className="quiz-bar-label">{bar.label}</span>
                                                    <div className="quiz-bar-track" aria-hidden="true">
                                                        <motion.div className="quiz-bar-fill"
                                                            initial={{ width: 0 }}
                                                            animate={{ width: `${(bar.value / 5) * 100}%` }}
                                                            transition={{ duration: 0.5, ease: [0.22, 0.61, 0.36, 1], delay: 0.1 }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
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
