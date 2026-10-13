import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved. Without
// this line ConfigService.get('YOUR_KEY') returns undefined because the
// cached schema would still be the base shape. See guide/configuration.
import './config'
// @kick:imports
import { modules } from './modules'

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) throw new Error('SESSION_SECRET is not set — see .env.example')

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({
  modules,
  // @kick:runtime
  middlewares: [
    requestId(),
    // @kick:middleware
    // Carries validation errors and flash messages to the next page.
    session({ secret: sessionSecret }),
  ],
  adapters: [
    InertiaAdapter({
      title: '{{name}}',
      entry: 'src/client/main.tsx',
      // On every page. Per-page titles and meta: Inertia's <Head> component.
      head: '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
      // Props every page receives.
      share: () => ({ appName: '{{name}}' }),
      ssr: { entry: 'src/client/ssr.tsx' },
      // Unknown URLs and thrown errors render src/client/pages/Error.tsx.
      errorPage: 'Error',
    }),
    // @kick:adapter
  ],
  // A failed validation on an Inertia visit goes back to the form with
  // `props.errors` instead of answering 422.
  onError: inertiaErrorHandler(),
})
