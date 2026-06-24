import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Auth0Provider } from '@auth0/auth0-react';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import posthog from 'posthog-js';
import './themes.css';
import './index.css';
import App from './App.jsx';

const analyticsConsent = localStorage.getItem('sensemap_analytics_consent');
const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';

const founderOptOut = document.cookie.includes('ph_optout=1');

if (!dnt && analyticsConsent !== 'false' && !founderOptOut) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    session_recording: { maskAllInputs: true },
    loaded: (ph) => {
      if (analyticsConsent !== 'true') ph.opt_out_capturing();
    },
  });
} else if (founderOptOut || window.location.hostname === 'localhost') {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    loaded: (ph) => { ph.opt_out_capturing(); },
  });
}

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN || '';
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID || '';
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE || '';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Auth0Provider
        domain={AUTH0_DOMAIN}
        clientId={AUTH0_CLIENT_ID}
        authorizationParams={{
          redirect_uri: window.location.origin,
          ...(AUTH0_AUDIENCE && { audience: AUTH0_AUDIENCE }),
        }}
        onRedirectCallback={(appState) => {
          window.history.replaceState(
            {},
            document.title,
            appState?.returnTo || window.location.pathname
          );
        }}
      >
        <ThemeProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ThemeProvider>
      </Auth0Provider>
    </BrowserRouter>
  </StrictMode>,
);
