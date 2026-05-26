import { useState } from 'react';
import { isInAppBrowser } from '../utils';
import './LoginModal.css';

export default function LoginModal({ onGoogle, onEmail, onClose, onShowTerms, onShowPrivacy }) {
    const [step, setStep] = useState('choose'); // 'choose' | 'email'
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');

    const handleEmailSubmit = (e) => {
        e.preventDefault();
        if (!email || !email.includes('@')) {
            setError('Please enter a valid email address.');
            return;
        }
        onEmail(email);
    };

    return (
        <div className="lm-overlay" onClick={onClose}>
            <div className="lm-card" role="dialog" aria-modal="true" aria-labelledby="lm-title" onClick={e => e.stopPropagation()}>
                <button className="lm-close" onClick={onClose} aria-label="Close">✕</button>

                <div className="lm-logo">
                    <img src="/favicon.png" alt="" aria-hidden="true" />
                </div>
                <h2 className="lm-title" id="lm-title">Sign in to SenseMap</h2>
                <p className="lm-sub">Save places, submit reviews, and get personalised matches.</p>

                {isInAppBrowser && (
                    <div className="lm-browser-notice">
                        Google sign-in is unavailable in this browser. Use email instead.
                    </div>
                )}

                <div className="lm-actions">
                    {!isInAppBrowser && (
                        <button className="lm-btn lm-btn-google" onClick={onGoogle}>
                            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                                <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                            </svg>
                            Continue with Google
                        </button>
                    )}

                    {!isInAppBrowser && (
                        <div className="lm-divider"><span>or</span></div>
                    )}

                    {step === 'choose' ? (
                        <button className="lm-btn lm-btn-email" onClick={() => setStep('email')}>
                            ✉️ Continue with Email
                        </button>
                    ) : (
                        <form className="lm-email-form" onSubmit={handleEmailSubmit}>
                            <input
                                type="email"
                                className="lm-email-input"
                                placeholder="you@example.com"
                                value={email}
                                onChange={e => { setEmail(e.target.value); setError(''); }}
                                autoFocus
                            />
                            {error && <p className="lm-error">{error}</p>}
                            <button type="submit" className="lm-btn lm-btn-submit">
                                Send sign-in link
                            </button>
                            <button type="button" className="lm-back" onClick={() => setStep('choose')}>
                                ← Back
                            </button>
                        </form>
                    )}
                </div>

                <p className="lm-terms">
                    By continuing, you agree to our <button className="lm-link" onClick={onShowTerms}>Terms</button> and <button className="lm-link" onClick={onShowPrivacy}>Privacy Policy</button>.
                </p>
            </div>
        </div>
    );
}
