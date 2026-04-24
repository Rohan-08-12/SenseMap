import { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from './services/api';
import LaunchScreen from './components/LaunchScreen';
import NonLoginMapView from './components/NonLoginMapView';
import LoggedInMapView from './components/LoggedInMapView';

/**
 * Main Application Component
 * Handles top-level routing and authentication state management.
 * Depending on the Auth0 login status, it directs the user to either the Full (LoggedIn) Map
 * or the Public (NonLogin) Map.
 */
function App() {
  // 🔓 DEV BYPASS: Use state to allow starting at landing page
  // const { isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const isLoading = false;
  const getAccessTokenSilently = async () => "demo-token";
  const [showMap, setShowMap] = useState(false);
  const [exploreParams, setExploreParams] = useState(null);

  useEffect(() => {
    if (isAuthenticated) {
      setTokenGetter(() => getAccessTokenSilently());
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

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#6b7280' }}>
        Loading...
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <LoggedInMapView 
        onBackToHome={handleBackToHome} 
        initialSearchQuery={exploreParams?.searchQuery} 
        initialFilter={exploreParams?.filter} 
        onLogout={() => setIsAuthenticated(false)}
      />
    );
  }

  if (showMap) {
    return (
      <NonLoginMapView
        onExploreMap={handleExploreMap}
        onBackToHome={handleBackToHome}
        initialSearchQuery={exploreParams?.searchQuery}
        initialFilter={exploreParams?.filter}
        onLogin={() => setIsAuthenticated(true)}
      />
    );
  }

  return (
    <LaunchScreen 
      onExploreMap={handleExploreMap} 
      onLogin={() => setIsAuthenticated(true)} 
      onLogout={() => setIsAuthenticated(false)} 
    />
  );
}

export default App;
