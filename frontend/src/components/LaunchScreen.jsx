import { useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../theme/ThemeContext.jsx';
import LogoutConfirmation from './LogoutConfirmation';
import LegalModal from './LegalModal';
import './LaunchScreen.css';

// ── Data ──────────────────────────────────────────────────────────────────────

const WHO_FOR = [
    { emoji: '🧠', label: 'Autistic adults', desc: 'Plan outings with confidence' },
    { emoji: '👨‍👩‍👧', label: 'Parents & caregivers', desc: 'Scout spaces before you go' },
    { emoji: '🤝', label: 'Support workers', desc: 'Match spaces to client needs' },
    { emoji: '🌿', label: 'Sensory-sensitive people', desc: 'Anyone who needs to know first' },
];

const STEPS = [
    {
        num: '01', title: 'Explore the map', tag: 'No login needed',
        desc: 'Open the interactive sensory map and browse thousands of Toronto spaces — cafes, parks, libraries, and more.',
        bullets: ['Colour-coded heatmap by comfort level', 'Filter by noise, lighting, or crowd density', 'Search any neighbourhood or landmark'],
        cta: 'Explore the map', ctaAction: 'explore',
    },
    {
        num: '02', title: 'Read the sensory profile', tag: 'Tap any pin',
        desc: 'Every location has a detailed sensory breakdown built from community reviews and AI analysis.',
        bullets: ['Noise, lighting, and crowd scores out of 5', 'AI-generated natural language summary', 'Recent reviews from the community'],
        cta: 'See an example', ctaAction: 'explore',
    },
    {
        num: '03', title: 'Submit a review', tag: 'Help the community',
        desc: 'Been somewhere recently? Rate its sensory environment to help others plan their visits.',
        bullets: ['Rate noise, lighting, and crowding on sliders', 'Add a photo and your visit time', 'Your review updates the score instantly'],
        cta: 'Sign up to review', ctaAction: 'login',
    },
    {
        num: '04', title: 'Personalise your map', tag: 'Sign up free',
        desc: 'Set your personal sensory tolerances and every place on the map gets a Match Score just for you.',
        bullets: ['Set your noise, lighting, and crowd tolerances', 'See your personalised comfort % for every place', 'AI recommendations based on your profile'],
        cta: 'Create free account', ctaAction: 'login',
    },
    {
        num: '05', title: 'Save places & check in', tag: 'Build your routine',
        desc: 'Bookmark the spots that work for you and build a personal library of safe, comfortable spaces.',
        bullets: ['Save favourites with one tap', 'Log check-ins to track your visits', 'Browse the community\'s top-rated comfortable spaces'],
        cta: 'Get started', ctaAction: 'login',
    },
];

const POPULAR_TAGS = [
    { label: 'Quiet spaces', filter: 'quiet-now' },
    { label: 'Soft lighting', filter: 'soft-lighting' },
    { label: 'Low crowds', filter: 'low-crowds' },
    { label: 'Outdoor areas', filter: 'outdoor' },
    { label: 'Before-noon spots', filter: 'before-noon' },
];

// ── SVG Illustrations ─────────────────────────────────────────────────────────

function StepSVG01() {
    return (
        <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
            <rect width="280" height="200" rx="12" fill="#f0ebe0" />
            {[40,70,100,130,160].map(y => <line key={y} x1="0" y1={y} x2="280" y2={y} stroke="#ddd6c8" strokeWidth="1" />)}
            {[50,100,150,200,250].map(x => <line key={x} x1={x} y1="0" x2={x} y2="200" stroke="#ddd6c8" strokeWidth="1" />)}
            <circle cx="140" cy="100" r="42" fill="rgba(45,106,79,0.11)" />
            <circle cx="140" cy="100" r="26" fill="rgba(45,106,79,0.17)" />
            {[[90,70],[182,90],[118,142],[174,152]].map(([cx,cy],i) => (
                <g key={i}><circle cx={cx} cy={cy} r="8" fill="#2d6a4f" stroke="white" strokeWidth="2" /><circle cx={cx} cy={cy} r="3" fill="white" /></g>
            ))}
            <g><circle cx="140" cy="100" r="8" fill="#c05e3c" stroke="white" strokeWidth="2" /><circle cx="140" cy="100" r="3" fill="white" /></g>
            <rect x="10" y="10" width="90" height="22" rx="6" fill="rgba(255,255,255,0.9)" />
            <text x="20" y="25" fontFamily="DM Sans, sans-serif" fontSize="9" fill="#2d6a4f" fontWeight="600">Sensory Map</text>
        </svg>
    );
}

function StepSVG02() {
    return (
        <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
            <rect width="280" height="200" rx="12" fill="#f0ebe0" />
            <rect x="20" y="20" width="240" height="162" rx="10" fill="white" />
            <text x="36" y="46" fontFamily="Georgia, serif" fontSize="12" fill="#1a1a18" fontWeight="700">Bloor Library</text>
            <text x="36" y="62" fontFamily="DM Sans, sans-serif" fontSize="9" fill="#888">📍 789 Yonge St · Library</text>
            {[['Noise', 0.26, '1.3'],['Lighting', 0.46, '2.3'],['Crowds', 0.30, '1.5']].map(([label, val, score], i) => (
                <g key={label}>
                    <text x="36" y={88+i*28} fontFamily="DM Sans, sans-serif" fontSize="9" fill="#666">{label}</text>
                    <rect x="90" y={78+i*28} width="120" height="6" rx="3" fill="#eee" />
                    <rect x="90" y={78+i*28} width={120*val} height="6" rx="3" fill="#2d6a4f" />
                    <text x="218" y={88+i*28} fontFamily="DM Sans, sans-serif" fontSize="9" fill="#2d6a4f" fontWeight="600">{score}/5</text>
                </g>
            ))}
            <rect x="36" y="155" width="96" height="16" rx="4" fill="#2d6a4f" />
            <text x="52" y="167" fontFamily="DM Sans, sans-serif" fontSize="8" fill="white" fontWeight="600">AI Insights</text>
        </svg>
    );
}

function StepSVG03() {
    return (
        <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
            <rect width="280" height="200" rx="12" fill="#f0ebe0" />
            <rect x="20" y="15" width="240" height="170" rx="10" fill="white" />
            <text x="36" y="40" fontFamily="Georgia, serif" fontSize="12" fill="#1a1a18" fontWeight="700">Submit a review</text>
            {[['Noise level', 0.3],['Lighting', 0.5],['Crowd level', 0.2]].map(([label, val], i) => (
                <g key={label}>
                    <text x="36" y={65+i*32} fontFamily="DM Sans, sans-serif" fontSize="9" fill="#555">{label}</text>
                    <rect x="36" y={70+i*32} width="180" height="6" rx="3" fill="#eee" />
                    <rect x="36" y={70+i*32} width={180*val} height="6" rx="3" fill="#2d6a4f" />
                    <circle cx={36+180*val} cy={73+i*32} r="5" fill="white" stroke="#2d6a4f" strokeWidth="2" />
                </g>
            ))}
            <rect x="36" y="158" width="100" height="18" rx="5" fill="#2d6a4f" />
            <text x="58" y="171" fontFamily="DM Sans, sans-serif" fontSize="9" fill="white" fontWeight="600">Submit</text>
        </svg>
    );
}

function StepSVG04() {
    return (
        <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
            <rect width="280" height="200" rx="12" fill="#f0ebe0" />
            <rect x="20" y="15" width="240" height="170" rx="10" fill="white" />
            <text x="36" y="40" fontFamily="Georgia, serif" fontSize="12" fill="#1a1a18" fontWeight="700">My sensory profile</text>
            {[['Noise tolerance',0.35],['Light tolerance',0.6],['Crowd tolerance',0.2]].map(([l,v],i) => (
                <g key={l}>
                    <text x="36" y={68+i*34} fontFamily="DM Sans, sans-serif" fontSize="9" fill="#555">{l}</text>
                    <rect x="36" y={73+i*34} width="180" height="6" rx="3" fill="#eee" />
                    <rect x="36" y={73+i*34} width={180*v} height="6" rx="3" fill="#2d6a4f" />
                    <circle cx={36+180*v} cy={76+i*34} r="5" fill="#2d6a4f" stroke="white" strokeWidth="2" />
                </g>
            ))}
            <rect x="36" y="152" width="64" height="22" rx="6" fill="rgba(45,106,79,0.12)" />
            <text x="44" y="167" fontFamily="DM Sans, sans-serif" fontSize="9" fill="#2d6a4f" fontWeight="600">86% match</text>
            <rect x="110" y="152" width="64" height="22" rx="6" fill="rgba(45,106,79,0.12)" />
            <text x="118" y="167" fontFamily="DM Sans, sans-serif" fontSize="9" fill="#2d6a4f" fontWeight="600">🏆 Top pick</text>
        </svg>
    );
}

function StepSVG05() {
    return (
        <svg viewBox="0 0 280 200" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%', display: 'block' }}>
            <rect width="280" height="200" rx="12" fill="#f0ebe0" />
            <rect x="20" y="15" width="240" height="170" rx="10" fill="white" />
            <text x="36" y="40" fontFamily="Georgia, serif" fontSize="12" fill="#1a1a18" fontWeight="700">Saved places</text>
            {[['Bloor Library','Library','92%'],['Trinity Bellwoods','Park','88%'],['Louie Coffee','Café','79%']].map(([name,type,score],i) => (
                <g key={name}>
                    <rect x="36" y={52+i*38} width="200" height="30" rx="6" fill="#f8f5ef" />
                    <text x="48" y={70+i*38} fontFamily="DM Sans, sans-serif" fontSize="9" fill="#1a1a18" fontWeight="600">{name}</text>
                    <text x="48" y={80+i*38} fontFamily="DM Sans, sans-serif" fontSize="8" fill="#888">{type}</text>
                    <rect x="196" y={57+i*38} width="32" height="16" rx="4" fill="rgba(45,106,79,0.15)" />
                    <text x="204" y={69+i*38} fontFamily="DM Sans, sans-serif" fontSize="8" fill="#2d6a4f" fontWeight="700">{score}</text>
                </g>
            ))}
        </svg>
    );
}

const STEP_SVGS = [StepSVG01, StepSVG02, StepSVG03, StepSVG04, StepSVG05];

// ── Component ─────────────────────────────────────────────────────────────────

function LaunchScreen({ onExploreMap, onLogin, onLogout }) {
    const { isAuthenticated, user } = useAuth0();
    const [searchQuery, setSearchQuery] = useState('');
    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [legalModal, setLegalModal] = useState(null);
    const [openStep, setOpenStep] = useState(0);
    const [showHowItWorks, setShowHowItWorks] = useState(false);
    const { theme, setTheme } = useTheme();

    const handleNavigate = (filter = null, query = '') => {
        if (onExploreMap) onExploreMap({ filter, searchQuery: query || searchQuery });
    };

    const handleSearch = (e) => {
        e.preventDefault();
        handleNavigate(null, searchQuery);
    };

    const toggleHowItWorks = () => setShowHowItWorks(prev => !prev);

    const handleStepCta = (action) => {
        if (action === 'explore') handleNavigate();
        else onLogin();
    };

    return (
        <div className="ls-root">

            {/* ── 1. Nav ─────────────────────────────────────────────── */}
            <nav className="ls-nav">
                <div className="ls-nav-logo">
                    <div className="ls-nav-icon">
                        <img src="/favicon.png" alt="" aria-hidden="true" />
                    </div>
                    <div>
                        <div className="ls-nav-name">SenseMap</div>
                        <div className="ls-nav-sub">Explore safely and simply</div>
                    </div>
                </div>

                <div className="ls-nav-auth">
                    {!isAuthenticated ? (
                        <>
                            <button className="ls-btn-ghost" onClick={() => onLogin()}>Log in</button>
                            <button className="ls-btn-green" onClick={() => onLogin()}>Sign up</button>
                        </>
                    ) : (
                        <>
                            <span className="ls-nav-user">{user?.name || user?.email}</span>
                            <button className="ls-btn-green" onClick={() => handleNavigate()}>Open map</button>
                            <button className="ls-btn-ghost" onClick={() => setShowLogoutModal(true)}>Log out</button>
                        </>
                    )}
                </div>
            </nav>

            {/* ── Theme bar (below nav) ──────────────────────────────── */}
            <div className="ls-topbar">
                <div className="ls-nav-theme" role="group" aria-label="Theme">
                    {['nature','calm'].map(t => (
                        <button
                            key={t}
                            className={`ls-theme-btn${theme === t ? ' active' : ''}`}
                            onClick={() => setTheme(t)}
                            aria-pressed={theme === t}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── 2. Hero ────────────────────────────────────────────── */}
            <section className="ls-hero">
                <motion.div className="ls-badge"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                >
                    ✨ A calmer way to explore
                </motion.div>

                <motion.h1 className="ls-hero-heading"
                    initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.07 }}
                >
                    The world is a lot.<br />
                    <em>We help you navigate it.</em>
                </motion.h1>

                <motion.p className="ls-hero-sub"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.13 }}
                >
                    SenseMap shows you how loud, bright, and crowded any public space in Toronto is — before you arrive. Community reviews. AI insights. Built for people who need to know.
                </motion.p>

                <motion.div className="ls-hero-btns"
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.19 }}
                >
                    <button className="ls-btn-green ls-btn-lg" onClick={() => handleNavigate()}>Explore the map</button>
                    <button className="ls-btn-ghost ls-btn-lg" onClick={toggleHowItWorks}>How it works</button>
                </motion.div>
            </section>

            {/* ── 3. Map Preview ─────────────────────────────────────── */}
            <section className="ls-map-section">
                <div className="ls-map-card">
                    <div
                        className="ls-map-wrap"
                        onClick={() => handleNavigate()}
                        role="button"
                        tabIndex={0}
                        aria-label="Open sensory map"
                        onKeyDown={e => e.key === 'Enter' && handleNavigate()}
                    >
                        <img
                            src="/assets/images/map-preview.jpg"
                            alt="Sensory map preview of Toronto"
                            className="ls-map-bg-img"
                            loading="lazy"
                            decoding="async"
                        />
                        <div className="ls-map-legend">
                            {[['#2d6a4f','Comfortable'],['#d4a017','Moderate'],['#c05e3c','Overwhelming']].map(([color,label]) => (
                                <div key={label} className="ls-legend-row">
                                    <span className="ls-legend-dot" style={{ background: color }} />
                                    {label}
                                </div>
                            ))}
                        </div>
                    </div>

                    <form className="ls-map-search" onSubmit={handleSearch}>
                        <div className="ls-search-input">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search places, needs, or triggers"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <button type="submit" className="ls-btn-green">Search</button>
                    </form>
                </div>

                <div className="ls-map-tags">
                    {POPULAR_TAGS.map(tag => (
                        <button key={tag.filter} className="ls-tag" onClick={() => handleNavigate(tag.filter)}>
                            {tag.label}
                        </button>
                    ))}
                </div>
            </section>

            {/* ── 4. Who it's for ────────────────────────────────────── */}
            <section className="ls-who-section">
                <div className="ls-who-inner">
                    <p className="ls-section-label">Built for</p>
                    <div className="ls-who-grid">
                        {WHO_FOR.map(w => (
                            <div key={w.label} className="ls-who-card">
                                <span className="ls-who-emoji" aria-hidden="true">{w.emoji}</span>
                                <strong>{w.label}</strong>
                                <span>{w.desc}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 6. Before / After ─────────────────────────────────── */}
            <section className="ls-ba-section">
                <div className="ls-ba-inner">
                    <p className="ls-section-label">Why it matters</p>
                    <h2 className="ls-ba-heading">
                        Going somewhere new<br />shouldn't feel like a gamble.
                    </h2>
                    <div className="ls-ba-cards">
                        <div className="ls-ba-card ls-ba-card--without">
                            <p className="ls-ba-label">Without SenseMap</p>
                            {[
                                { emoji: '😰', text: 'Arrive without knowing how loud or crowded it will be' },
                                { emoji: '🚶', text: 'Leave early because it was too overwhelming' },
                                { emoji: '😔', text: 'Miss out on places that could have worked for you' },
                            ].map(r => (
                                <div key={r.text} className="ls-ba-row">
                                    <span aria-hidden="true">{r.emoji}</span>
                                    <span>{r.text}</span>
                                </div>
                            ))}
                        </div>
                        <div className="ls-ba-card ls-ba-card--with">
                            <p className="ls-ba-label">With SenseMap</p>
                            {[
                                { emoji: '🗺️', text: 'Check sensory scores before you leave the house' },
                                { emoji: '🤖', text: 'Read AI insights and community reviews in seconds' },
                                { emoji: '✅', text: 'Arrive confident, stay longer, explore more' },
                            ].map(r => (
                                <div key={r.text} className="ls-ba-row">
                                    <span aria-hidden="true">{r.emoji}</span>
                                    <span>{r.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 7. Footer ─────────────────────────────────────────── */}
            <footer className="ls-footer">
                <div className="ls-footer-inner">
                    <div className="ls-footer-top">
                        <div className="ls-footer-brand">
                            <div className="ls-footer-logo">
                                <div className="ls-nav-icon ls-footer-icon">
                                    <img src="/favicon.png" alt="" aria-hidden="true" />
                                </div>
                                <span className="ls-footer-name">SenseMap</span>
                            </div>
                            <p className="ls-footer-tagline">A sensory accessibility map for neurodivergent people in Toronto.</p>
                        </div>

                        <div className="ls-footer-links">
                            <div className="ls-footer-col">
                                <p className="ls-footer-col-label">Product</p>
                                <button onClick={() => handleNavigate()}>Explore the map</button>
                                <button onClick={toggleHowItWorks}>How it works</button>
                                <button onClick={() => onLogin()}>Sign up</button>
                            </div>
                            <div className="ls-footer-col">
                                <p className="ls-footer-col-label">Community</p>
                                <button onClick={() => handleNavigate()}>Submit a review</button>
                                <a href="https://reddit.com/r/autism" target="_blank" rel="noopener noreferrer">r/autism</a>
                                <a href="https://reddit.com/r/ADHD" target="_blank" rel="noopener noreferrer">r/ADHD</a>
                            </div>
                            <div className="ls-footer-col">
                                <p className="ls-footer-col-label">Legal</p>
                                <button onClick={() => setLegalModal('privacy')}>Privacy Policy</button>
                                <button onClick={() => setLegalModal('terms')}>Terms of Use</button>
                                <a href="https://forms.gle/F1NGPGdcKJR6Qg7u9" target="_blank" rel="noopener noreferrer">Share feedback</a>
                            </div>
                        </div>
                    </div>

                    <div className="ls-footer-bottom">
                        <span>© 2026 SenseMap.</span>
                        <div className="ls-footer-trust">
                            {['Community data','No ads','No tracking','Toronto — expanding soon'].map((t, i, arr) => (
                                <span key={t} className="ls-trust-item">
                                    {t}{i < arr.length - 1 && <span className="ls-trust-sep" aria-hidden="true"> · </span>}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </footer>

            {/* ── How it works modal ─────────────────────────────────── */}
            <AnimatePresence>
                {showHowItWorks && (
                    <motion.div
                        className="ls-modal-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        onClick={toggleHowItWorks}
                    >
                        <motion.div
                            className="ls-modal-panel"
                            initial={{ opacity: 0, scale: 0.97, y: 24 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97, y: 24 }}
                            transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="ls-modal-header">
                                <div>
                                    <p className="ls-section-label" style={{ margin: 0 }}>Guide</p>
                                    <h2 className="ls-modal-title">How it works</h2>
                                </div>
                                <button className="ls-modal-close" onClick={toggleHowItWorks} aria-label="Close">✕</button>
                            </div>

                            <div className="ls-modal-body">
                                <div className="ls-accordion">
                                    {STEPS.map((step, i) => {
                                        const Illustration = STEP_SVGS[i];
                                        const isOpen = openStep === i;
                                        return (
                                            <div key={step.num} className={`ls-accord-item${isOpen ? ' open' : ''}`}>
                                                <button
                                                    className="ls-accord-header"
                                                    onClick={() => setOpenStep(isOpen ? -1 : i)}
                                                    aria-expanded={isOpen}
                                                >
                                                    <span className="ls-accord-num">{step.num}</span>
                                                    <span className="ls-accord-title">{step.title}</span>
                                                    <span className="ls-accord-tag">{step.tag}</span>
                                                    <span className="ls-accord-chevron" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                                                </button>

                                                <AnimatePresence initial={false}>
                                                    {isOpen && (
                                                        <motion.div
                                                            key="body"
                                                            initial={{ height: 0, opacity: 0 }}
                                                            animate={{ height: 'auto', opacity: 1 }}
                                                            exit={{ height: 0, opacity: 0 }}
                                                            transition={{ duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}
                                                            style={{ overflow: 'hidden' }}
                                                        >
                                                            <div className="ls-accord-content">
                                                                <div className="ls-accord-svg">
                                                                    <Illustration />
                                                                </div>
                                                                <div className="ls-accord-text">
                                                                    <p className="ls-accord-desc">{step.desc}</p>
                                                                    <ul className="ls-accord-bullets">
                                                                        {step.bullets.map(b => <li key={b}>{b}</li>)}
                                                                    </ul>
                                                                    <button className="ls-btn-green" onClick={() => { handleStepCta(step.ctaAction); toggleHowItWorks(); }}>
                                                                        {step.cta}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {showLogoutModal && (
                <LogoutConfirmation onCancel={() => setShowLogoutModal(false)} onLogout={onLogout} />
            )}
            {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
        </div>
    );
}

export default LaunchScreen;
