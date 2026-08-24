/* global process */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // BACKEND_PROXY_URL is a server-only var (not VITE_-prefixed, so it never
  // ships to the client bundle) — lets the dev server proxy to a backend
  // (e.g. production) while VITE_API_URL stays empty so the browser makes
  // same-origin requests and avoids CORS entirely.
  const backendUrl = env.BACKEND_PROXY_URL || env.VITE_API_URL || 'http://localhost:3000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/locations': backendUrl,
        '/discover': backendUrl,
        '/reviews': backendUrl,
        '/rankings': backendUrl,
        '/profiles': backendUrl,
        '/ai': backendUrl,
        '/saved-places': backendUrl,
        '/upload': backendUrl,
        '/checkins': backendUrl,
        '/users': backendUrl,
        '/audio': backendUrl,
        '/enrichment': backendUrl,
        '/scraper': backendUrl,
        '/subscribe': backendUrl,
      },
    },
  }
})
