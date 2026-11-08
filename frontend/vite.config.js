/* global process */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api calls to the FastAPI backend (uvicorn src.api:app --port 8000).
    // Set API_PORT to use another port, e.g. API_PORT=8001 npm run dev.
    proxy: {
      '/api': `http://localhost:${process.env.API_PORT || 8000}`,
    },
  },
})
