import { useEffect } from 'react';
import './LegalModal.css';

const PRIVACY_CONTENT = {
    title: 'Privacy Policy',
    updated: 'June 2026',
    sections: [
        {
            heading: 'What we collect',
            body: 'We collect your account information (name, email) through Auth0 when you sign in. When you use the app we also store the sensory reviews you write, your sensory profile preferences, saved places, and check-ins. If you grant location permission, your device coordinates are used in-session to show nearby places — we do not store your raw GPS coordinates.',
        },
        {
            heading: 'How we use it',
            body: 'Your sensory profile is used to calculate personalised match scores for locations. Your reviews contribute to the community comfort scores shown on the map. Your email is used only for account identification — we do not send marketing emails.',
        },
        {
            heading: 'Third-party services',
            body: 'We use Auth0 for authentication, Supabase/PostgreSQL to store your account data and reviews, Cloudinary to host place photos, and Google Gemini (AI) to analyse review text for sensory signals. To provide AI-estimated sensory scores, we query publicly available review data from Yelp Fusion API, Foursquare Places API, Reddit (public posts), and Google Places API. We also use City of Toronto Open Data (a public dataset) for park and library facility descriptions. None of your personal data is shared with these services — only location names and coordinates are sent to look up public reviews. Each third-party service operates under its own privacy policy. Data may be processed on servers outside your country of residence.',
        },
        {
            heading: 'AI-estimated scores',
            body: 'Many locations display AI-estimated sensory scores derived from publicly available reviews on Yelp, Foursquare, Google, and Reddit. These scores are generated using Google Gemini and are not based on your personal data. They are clearly labelled "AI estimate" in the app.',
        },
        {
            heading: 'Sensitive data',
            body: 'SenseMap may infer that users have sensory sensitivities or neurodivergent conditions based on their use of the app and the sensory profile they set. We treat this information with care, do not share it with advertisers, and do not use it for purposes beyond delivering the core app experience.',
        },
        {
            heading: 'Cookies, local storage, and analytics',
            body: 'We use browser localStorage to save your theme preference and onboarding status. Auth0 uses cookies and localStorage to maintain your login session. We use PostHog to collect product analytics including page views, feature interactions, and session recordings. PostHog may store cookies or localStorage entries in your browser; data is processed on servers in the United States. Session recordings may capture on-screen interactions but do not record passwords or sensitive form inputs. We do not use advertising or tracking cookies. You can opt out of analytics by enabling "Do Not Track" in your browser settings.',
        },
        {
            heading: 'Data retention',
            body: 'Your data is retained until you delete your account. You can permanently delete your account and all associated data at any time from Settings → Delete account. This action is irreversible.',
        },
        {
            heading: 'Your rights',
            body: 'You can view, update, or delete your sensory profile at any time. You can remove saved places and reviews individually. If you are in the EU or California, you have the right to request a copy of your data, request deletion, or restrict processing — contact us at the address below. We do not sell your personal data.',
        },
        {
            heading: 'Contact',
            body: 'For privacy questions contact: hello@sensemap.app',
        },
    ],
};

const TERMS_CONTENT = {
    title: 'Terms of Use',
    updated: 'June 2026',
    sections: [
        {
            heading: 'Using SenseMap',
            body: 'SenseMap is a community platform for sharing sensory information about public spaces. You may use it for personal, non-commercial purposes. You must be 18 years or older to create an account.',
        },
        {
            heading: 'Your reviews',
            body: 'Reviews you submit become part of the community dataset and are used to calculate aggregate sensory scores. Please submit honest, first-hand sensory observations. Do not include personally identifiable information about individuals, offensive content, or deliberate misinformation. SenseMap reserves the right to remove any content that violates these guidelines without notice. Reviews reflect the views of individual users, not SenseMap.',
        },
        {
            heading: 'Accuracy',
            body: 'Sensory scores are derived from two sources: community reviews submitted by real visitors, and AI-estimated scores generated automatically from publicly available reviews on Yelp, Foursquare, Google, and Reddit. All AI-estimated scores are clearly labelled in the app. Scores reflect general patterns, not guarantees — conditions at any location may change. SenseMap is not liable for decisions made based on the information shown.',
        },
        {
            heading: 'Not medical advice',
            body: 'SenseMap is not a medical, therapeutic, or clinical service. Sensory comfort scores are community estimates and AI-generated approximations — they do not constitute professional advice and should not replace guidance from a qualified healthcare provider, occupational therapist, or other specialist. Use SenseMap as a general guide only.',
        },
        {
            heading: 'AI-generated content',
            body: 'Sensory scores and insights for many locations are generated automatically by Google Gemini using publicly available review text from Yelp, Foursquare, Google Places, Reddit, and City of Toronto Open Data. AI-generated content may occasionally be inaccurate, incomplete, or outdated. It is clearly labelled "AI estimate" and should be used as a guide alongside real community reviews. SenseMap does not guarantee the accuracy of AI-generated sensory profiles.',
        },
        {
            heading: 'Third-party data',
            body: 'Location photos may be sourced from Google Places API ("Powered by Google") and hosted on Cloudinary. Sensory score estimates use publicly available review data from Yelp, Foursquare, Google, and Reddit. SenseMap is not affiliated with these services and does not guarantee the accuracy or completeness of their data.',
        },
        {
            heading: 'Age requirement',
            body: 'You must be 18 years or older to create an account. We do not knowingly collect personal data from minors under 18. If we become aware that an account belongs to a user under 18, it will be terminated and associated data deleted.',
        },
        {
            heading: 'Changes',
            body: 'We may update these terms as the platform evolves. Continued use after updates constitutes acceptance. For questions contact: hello@sensemap.app',
        },
    ],
};

export default function LegalModal({ type, onClose }) {
    const content = type === 'privacy' ? PRIVACY_CONTENT : TERMS_CONTENT;

    useEffect(() => {
        const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [onClose]);

    return (
        <div className="legal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={content.title}>
            <div className="legal-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="legal-header">
                    <div>
                        <h2 className="legal-title">{content.title}</h2>
                        <span className="legal-updated">Last updated {content.updated}</span>
                    </div>
                    <button className="legal-close" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <div className="legal-body">
                    {content.sections.map((s) => (
                        <div key={s.heading} className="legal-section">
                            <h3>{s.heading}</h3>
                            <p>{s.body}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
