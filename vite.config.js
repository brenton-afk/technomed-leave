import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Stamped into the bundle at build time so the running app can show which
// commit it came from — Vercel sets VERCEL_GIT_COMMIT_SHA during the build.
// Without this, "am I looking at the new version?" can only be answered by
// comparing asset hashes, which is not something you can do on a phone.
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || 'local-dev').slice(0, 7)
const builtAt = new Date().toISOString()

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT_AT__: JSON.stringify(builtAt)
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  }
})
