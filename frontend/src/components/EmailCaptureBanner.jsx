import { useState, useEffect } from 'react';
import { subscribeEmail } from '../services/api';
import './EmailCaptureBanner.css';

const STORAGE_KEY = 'sensorysafe_email_banner';
const REVEAL_DELAY_MS = 60000;
const REVEAL_VIEW_COUNT = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadBannerState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { dismissed: false, subscribed: false };
  } catch {
    return { dismissed: false, subscribed: false };
  }
}

function saveBannerState(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadBannerState(), ...patch }));
  } catch {
    // localStorage unavailable — banner just won't remember dismissal across visits
  }
}

/**
 * EmailCaptureBanner
 * Public-map email signup for the weekly "new quiet spots" digest.
 * Appears after 60s idle or once the visitor has viewed 3+ locations —
 * whichever happens first — and stays dismissed/subscribed on future visits.
 */
function EmailCaptureBanner({ viewedCount = 0 }) {
  // Suppressed for the rest of this browser (dismissed or already subscribed on a prior visit).
  const [suppressed] = useState(() => {
    const state = loadBannerState();
    return state.dismissed || state.subscribed;
  });
  const [dismissedNow, setDismissedNow] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | submitting | success | error

  useEffect(() => {
    if (suppressed) return;
    const timer = setTimeout(() => setTimeElapsed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [suppressed]);

  const visible = !suppressed && !dismissedNow && (timeElapsed || viewedCount >= REVEAL_VIEW_COUNT);

  const handleDismiss = () => {
    setDismissedNow(true);
    saveBannerState({ dismissed: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setStatus('error');
      return;
    }
    setStatus('submitting');
    try {
      await subscribeEmail(trimmed, 'banner');
      setStatus('success');
      saveBannerState({ subscribed: true });
    } catch {
      setStatus('error');
    }
  };

  if (!visible) return null;

  return (
    <div className="ecb-banner" role="dialog" aria-label="Weekly quiet spots email signup">
      {status !== 'success' && (
        <button type="button" className="ecb-close" onClick={handleDismiss} aria-label="Dismiss">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}

      {status === 'success' ? (
        <div className="ecb-confirm">
          <span className="ecb-confirm-icon" aria-hidden>✓</span>
          <p>You're on the list. We'll send you quiet spots every Sunday.</p>
        </div>
      ) : (
        <form className="ecb-form" onSubmit={handleSubmit}>
          <h4 className="ecb-title">Get a weekly list of new quiet spots in Toronto</h4>
          <div className="ecb-input-row">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === 'error') setStatus('idle');
              }}
              disabled={status === 'submitting'}
              aria-label="Email address"
              autoComplete="email"
            />
            <button type="submit" disabled={status === 'submitting'}>
              {status === 'submitting' ? 'Sending…' : 'Send me the list'}
            </button>
          </div>
          {status === 'error' && <p className="ecb-error">Please enter a valid email address.</p>}
          <p className="ecb-fineprint">Free. No spam. Unsubscribe anytime.</p>
        </form>
      )}
    </div>
  );
}

export default EmailCaptureBanner;
