import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // The KickJS server (kick dev) listens on 3000; the client's baseUrl is
    // the relative '/api/v1', so the browser hits Vite and Vite forwards.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
