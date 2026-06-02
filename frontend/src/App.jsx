import { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { setTokenGetter } from './services/api';
import { isInAppBrowser } from './utils';
import LaunchScreen from './components/LaunchScreen';
import NonLoginMapView from './components/NonLoginMapView';
import LoggedInMapView from './components/LoggedInMapView';
import OnboardingModal, { hasSeenOnboarding } from './components/OnboardingModal';
import LoginModal from './components/LoginModal';
import LegalModal from './components/LegalModal';
import CookieConsent from './components/CookieConsent';
import NotFound from './components/NotFound';

/**
 * Main Application Component
 * Handles top-level routing and authentication state management.
 * Depending on the Auth0 login status, it directs the user to either the Full (LoggedIn) Map
 * or the Public (NonLogin) Map.
 */

function InAppBrowserBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (!isInAppBrowser || dismissed) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: '#1d4ed8', color: '#fff', padding: '12px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontFamily: 'Inter, sans-serif', fontSize: '14px', gap: '12px',
    }}>
      <span>Google sign-in is unavailable here — use <strong>Sign in with Email</strong> instead.</span>
      <button onClick={() => setDismissed(true)} style={{
        background: 'transparent', border: '1px solid rgba(255,255,255,0.5)',
        color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
      }}>Got it</button>
    </div>
  );
}

function App() {
  const { isAuthenticated, isLoading, getAccessTokenSilently, loginWithRedirect, logout } = useAuth0();
  const location = useLocation();
  const isRoot = location.pathname === '/';
  const [showMap, setShowMap] = useState(false);
  const [exploreParams, setExploreParams] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [legalModal, setLegalModal] = useState(null);

  useEffect(() => {
    if (isAuthenticated) {
      setTokenGetter(() => getAccessTokenSilently());
      if (!hasSeenOnboarding()) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowOnboarding(true);
      }
    } else {
      setTokenGetter(null);
    }
  }, [isAuthenticated, getAccessTokenSilently]);

  const handleExploreMap = (params) => {
    setExploreParams(params || null);
    setShowMap(true);
  };

  const handleBackToHome = () => {
    setShowMap(false);
  };

  const handleOpenLogin = () => setShowLoginModal(true);

  const handleGoogleLogin = () => {
    setShowLoginModal(false);
    loginWithRedirect();
  };

  const handleEmailLogin = (email) => {
    setShowLoginModal(false);
    loginWithRedirect({
      authorizationParams: {
        connection: 'email',
        login_hint: email,
        prompt: 'login',
      },
    });
  };

  if (!isRoot) {
    return (
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  }

  const loginModal = showLoginModal && (
    <LoginModal
      onGoogle={handleGoogleLogin}
      onEmail={handleEmailLogin}
      onClose={() => setShowLoginModal(false)}
      onShowTerms={() => { setShowLoginModal(false); setLegalModal('terms'); }}
      onShowPrivacy={() => { setShowLoginModal(false); setLegalModal('privacy'); }}
    />
  );

  if (isLoading) {
    return (
      <>
        <InAppBrowserBanner />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#6b7280' }}>
          Loading...
        </div>
      </>
    );
  }

  if (isAuthenticated) {
    return (
      <>
        <InAppBrowserBanner />
        <LoggedInMapView
          onBackToHome={handleBackToHome}
          initialSearchQuery={exploreParams?.searchQuery}
          initialFilter={exploreParams?.filter}
          onLogout={() => logout({ logoutParams: { returnTo: window.location.origin } })}
          hideControls={showOnboarding}
        />
        {showOnboarding && (
          <OnboardingModal onDone={() => setShowOnboarding(false)} />
        )}
        <CookieConsent />
      </>
    );
  }

  if (showMap) {
    return (
      <>
        <InAppBrowserBanner />
        <NonLoginMapView
          onExploreMap={handleExploreMap}
          onBackToHome={handleBackToHome}
          initialSearchQuery={exploreParams?.searchQuery}
          initialFilter={exploreParams?.filter}
          onLogin={handleOpenLogin}
        />
        {loginModal}
        <CookieConsent />
      </>
    );
  }

  return (
    <>
      <InAppBrowserBanner />
      <LaunchScreen
        onExploreMap={handleExploreMap}
        onLogin={handleOpenLogin}
        onLogout={() => logout({ logoutParams: { returnTo: window.location.origin } })}
      />
      {loginModal}
      {legalModal && <LegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
      <CookieConsent />
    </>
  );
}

export default App;
