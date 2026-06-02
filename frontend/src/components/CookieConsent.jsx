import { useState, useEffect } from 'react';
import posthog from 'posthog-js';
import './CookieConsent.css';

const CONSENT_KEY = 'sensemap_analytics_consent';

export default function CookieConsent() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem(CONSENT_KEY);
        const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';
        if (!stored && !dnt) setVisible(true);
    }, []);

    const accept = () => {
        localStorage.setItem(CONSENT_KEY, 'true');
        posthog.opt_in_capturing();
        setVisible(false);
    };

    const decline = () => {
        localStorage.setItem(CONSENT_KEY, 'false');
        posthog.opt_out_capturing();
        setVisible(false);
    };

    if (!visible) return null;

    return (
        <div className="cookie-banner" role="dialog" aria-label="Cookie consent">
            <p className="cookie-text">
                We use analytics (PostHog) to understand how SenseMap is used and improve the experience.
                No advertising cookies. Session recordings mask all inputs.{' '}
                <button className="cookie-link" onClick={() => {
                    document.dispatchEvent(new CustomEvent('open-legal', { detail: 'privacy' }));
                }}>Privacy Policy</button>
            </p>
            <div className="cookie-actions">
                <button className="cookie-btn cookie-btn--decline" onClick={decline}>Decline</button>
                <button className="cookie-btn cookie-btn--accept" onClick={accept}>Accept</button>
            </div>
        </div>
    );
}
