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
  adapters: [
    // @kick:adapter
  ],
  middlewares: [
    // Security headers. The framework injects helmet() with these defaults
    // anyway — declaring it here is what lets you CHANGE them, e.g.
    // helmet({ frameguard: 'SAMEORIGIN' }) or helmet({ hsts: false }).
    // Auto-injection stands down as soon as this line is present.
    helmet(),
    cors({ origin: '*' }),
    requestId(),
    requestLogger(),
    // @kick:middleware
  ],
})
