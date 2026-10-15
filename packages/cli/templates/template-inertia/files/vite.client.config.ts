import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production builds of the pages (`{{runBuild}}` runs both):
//   vite build --config vite.client.config.ts                         → dist/client
//   vite build --config vite.client.config.ts --ssr src/client/ssr.tsx → dist/ssr/ssr.js
// InertiaAdapter reads dist/client/.vite/manifest.json for the script tags
// and renders pages with dist/ssr/ssr.js.
// Production builds only. The server's .env sets NODE_ENV=development, and
// some tools (the Netlify CLI) load it into the environment: these would
// become development builds, and a development JSX transform fails under the
// production React the render bundle carries.
process.env.NODE_ENV = 'production'

export default defineConfig(({ isSsrBuild }) => ({
  // Nothing from the server's .env belongs in the browser bundle.
  envDir: false,
  plugins: [react()],
  // Same aliases as the dev server: tsconfig.json `paths`.
  resolve: { tsconfigPaths: true },
  // The SSR bundle carries its dependencies: a Netlify or Vercel function
  // has no node_modules to resolve React from.
  ssr: { noExternal: true },
  // Inlined, React would pick its build from NODE_ENV at runtime and carry both.
  define: isSsrBuild ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: isSsrBuild
    ? // public/ is served from dist/client; the render bundle doesn't need a copy.
      { outDir: 'dist/ssr', copyPublicDir: false }
    : { outDir: 'dist/client', manifest: true, rollupOptions: { input: 'src/client/main.tsx' } },
}))
