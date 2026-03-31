import type { Plugin } from 'vite'
import type { PluginContext } from './context'

/**
 * Core plugin — sets base configuration for KickJS server apps.
 *
 * - Externalizes Node.js built-ins and common server dependencies
 * - Sets Node 20 target
 * - Configures SSR externals for framework packages
 */
export function kickjsCorePlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:core',

    config() {
      return {
        build: {
          target: 'node20',
          ssr: true,
          rollupOptions: {
            input: ctx.entry,
            output: { format: 'esm' },
          },
        },
        ssr: {
          external: [
            'pino',
            'pino-pretty',
            'reflect-metadata',
            'express',
            'multer',
            'cookie-parser',
          ],
        },
      }
    },
  }
}
