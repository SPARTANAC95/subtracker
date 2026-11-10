import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Port map:
    //   5273 → the real app (server.mjs via launch.bat). The user's browser
    //          data lives on the localhost:5273 origin — never take this port.
    //   5280 → this dev server (development only)
    //   5274 → vite preview
    // strictPort makes a collision fail loudly instead of silently drifting
    // onto another origin.
    host: '127.0.0.1',
    port: 5280,
    strictPort: true,
    // In dev, data calls go to the real data server if it is running, so dev
    // sessions share the same on-disk data file. If it isn't running, the app
    // just falls back to browser-only storage.
    proxy: {
      '/api': { target: 'http://127.0.0.1:5273', changeOrigin: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5274,
    strictPort: true,
  },
  build: {
    // The app only ever runs in the user's own, current browser.
    target: 'es2022',
    rollupOptions: {
      output: {
        // React changes far less often than the app: in its own chunk it
        // stays cached across rebuilds.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
        },
      },
    },
  },
})
