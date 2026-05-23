import { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { setTokenGetter } from './services/api';
import LaunchScreen from './components/LaunchScreen';
import NonLoginMapView from './components/NonLoginMapView';
import LoggedInMapView from './components/LoggedInMapView';
import OnboardingModal, { hasSeenOnboarding } from './components/OnboardingModal';
import NotFound from './components/NotFound';

/**
 * Main Application Component
 * Handles top-level routing and authentication state management.
 * Depending on the Auth0 login status, it directs the user to either the Full (LoggedIn) Map
 * or the Public (NonLogin) Map.
 */
const isInAppBrowser = /LinkedIn|Instagram|FBAN|FBAV|FB_IAB|Twitter|Line|WhatsApp/i.test(navigator.userAgent);

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
      <span>For Google sign-in, open this page in Safari or Chrome.</span>
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

  useEffect(() => {
    if (isAuthenticated) {
      setTokenGetter(() => getAccessTokenSilently());
      if (!hasSeenOnboarding()) {
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

  if (!isRoot) {
    return (
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    );
  }

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
          onLogin={() => loginWithRedirect()}
        />
      </>
    );
  }

  return (
    <>
      <InAppBrowserBanner />
      <LaunchScreen
        onExploreMap={handleExploreMap}
        onLogin={() => loginWithRedirect()}
        onLogout={() => logout({ logoutParams: { returnTo: window.location.origin } })}
      />
    </>
  );
}

export default App;
