import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward /api calls to the FastAPI backend (uvicorn src.api:app --port 8000).
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
