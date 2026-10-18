import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
// @kick:imports
import { modules } from './modules'

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({
  modules,
  // @kick:runtime
  middlewares: [
    requestId(),
    // @kick:middleware
    // Carries validation errors and flash messages to the next page. Kept in
    // an encrypted cookie, so it works on any number of instances — several
    // containers, or Netlify / Vercel functions — with nothing shared.
    session({ secret: getEnv('SESSION_SECRET'), store: 'cookie' }),
  ],
  adapters: [
    InertiaAdapter({
      title: '{{name}}',
      entry: 'src/client/main.tsx',
      head: '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
      // Canonical URLs and absolute image URLs start here — not at the Host header.
      baseUrl: getEnv('APP_URL'),
      // Every page's meta starts from these; a controller adds its own with
      // inertia(component, props, { meta }), and src/client/Seo.tsx keeps the
      // browser's <head> in sync on client-side visits.
      meta: {
        lang: 'en',
        titleTemplate: '%s · {{name}}',
        description: '{{name}}, built with KickJS and Inertia.',
        // Link previews: add `image: '/og.png'` (1200×630, in public/) and
        // switch the card to 'summary_large_image'.
        og: { site_name: '{{name}}', type: 'website' },
        twitter: { card: 'summary' },
        // Any other <meta> / <link>: hreflang alternates, preloads.
        head: [h('meta', { name: 'theme-color', content: '#ffffff' })],
      },
      // Props every page receives.
      share: () => ({ appName: '{{name}}' }),
      ssr: { entry: 'src/client/ssr.tsx' },
      // Unknown URLs and thrown errors render src/client/pages/Error.tsx
      // (through inertiaNotFound / inertiaErrorHandler below).
      errorPage: 'Error',
    }),
    // @kick:adapter
  ],
  // A failed validation on an Inertia visit goes back to the form with
  // `props.errors` instead of answering 422.
  onError: inertiaErrorHandler(),
  // Unknown URLs: the Error page for browsers, the usual 404 / 405 for API calls.
  onNotFound: inertiaNotFound(),
  // Answer unknown URLs here in dev too — not by handing them back to Vite —
  // so `kick dev` shows the same Error page as production on every runtime.
  notFoundFallthrough: false,
})
