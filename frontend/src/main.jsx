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

posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: 'https://us.i.posthog.com',
  capture_pageview: true,
  capture_pageleave: true,
  session_recording: { maskAllInputs: false },
});

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
