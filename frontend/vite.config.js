/* global process */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL || 'http://localhost:3000'

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
      },
    },
  }
})
