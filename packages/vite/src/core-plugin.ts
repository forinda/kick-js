/**
 * Core Vite plugin for KickJS — configures the Vite server for backend
 * framework use: custom app type, SSR environment, and Node.js target.
 *
 * This plugin runs first in the array and sets up the environment that
 * the other sub-plugins (dev-server, virtual-modules, hmr) depend on.
 *
 * @module @forinda/kickjs-vite/core-plugin
 */

import type { Plugin } from 'vite'
import type { PluginContext } from './types'

/**
 * Creates the core configuration plugin.
 *
 * Responsibilities:
 * - Sets `appType: 'custom'` so Vite doesn't serve index.html
 * - Configures the SSR environment for Node.js backend code
 * - Prevents Vite from clearing the terminal (KickJS logs route tables on startup)
 * - Externalizes Node.js built-ins and framework packages from the bundle
 *
 * @param ctx - Shared plugin context (entry file, root directory)
 * @returns Vite plugin
 */
export function kickjsCorePlugin(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:core',

    /**
     * Vite config hook — runs before config is resolved.
     * Sets the foundational configuration for a backend Node.js framework.
     */
    config(_config, { command }) {
      return {
        // 'custom' tells Vite this is not a SPA or MPA — we handle all requests
        appType: 'custom' as const,

        // Don't clear the terminal — KickJS logs route tables on startup
        clearScreen: false,

        // SSR environment configuration for backend code
        environments: {
          ssr: {
            // Warm up the entry file for faster first request
            dev: {
              warmup: [ctx.entry],
            },
          },
        },

        // Optimize common dependencies for faster dev startup
        optimizeDeps: {
          // Only run optimizeDeps for the client environment (not SSR)
          noDiscovery: command === 'serve',
        },

        // SSR-specific settings
        ssr: {
          // Externalize Node.js built-ins and framework packages
          // These should NOT be bundled by Vite — they run natively in Node
          external: [
            '@forinda/kickjs',
            '@forinda/kickjs-core',
            '@forinda/kickjs-http',
            'express',
            'reflect-metadata',
          ],
        },
      }
    },
  }
}
