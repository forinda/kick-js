import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { compressAssets } from '@forinda/kickjs-vite/compress'

export default defineConfig({
  // compressAssets: writes .br / .gz beside the built files, which the server
  // sends to browsers that accept them instead of compressing on each request.
  plugins: [react(), compressAssets()],
  server: {
    // The KickJS server (kick dev) listens on 3000; the client's baseUrl is
    // the relative '/api/v1', so the browser hits Vite and Vite forwards.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
