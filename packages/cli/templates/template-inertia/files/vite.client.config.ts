import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production builds of the pages (`pnpm build` runs both):
//   vite build --config vite.client.config.ts                         → dist/client
//   vite build --config vite.client.config.ts --ssr src/client/ssr.tsx → dist/ssr/ssr.js
// InertiaAdapter reads dist/client/.vite/manifest.json for the script tags
// and renders pages with dist/ssr/ssr.js.
export default defineConfig(({ isSsrBuild }) => ({
  // The server's .env sets NODE_ENV=development, which would make these
  // development builds. The browser bundle needs nothing from it.
  envDir: false,
  plugins: [react()],
  // Same aliases as the dev server: tsconfig.json `paths`.
  resolve: { tsconfigPaths: true },
  build: isSsrBuild
    ? { outDir: 'dist/ssr' }
    : { outDir: 'dist/client', manifest: true, rollupOptions: { input: 'src/client/main.tsx' } },
}))
