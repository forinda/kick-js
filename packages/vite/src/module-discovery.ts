/**
 * Module discovery plugin for KickJS — automatically detects `@Module` classes
 * by scanning source files during Vite's `transform()` hook.
 *
 * ## How It Works
 *
 * 1. Vite calls `transform(code, id)` for every file it processes
 * 2. This plugin checks if the file matches `*.module.ts` (or `.js`)
 * 3. If the file contains a class exported with `@Module` or extends `AppModule`,
 *    it extracts the class name and records the file path
 * 4. The virtual module `virtual:kickjs/app` is invalidated so the next request
 *    picks up the newly discovered module
 *
 * ## Why This Matters
 *
 * Without auto-discovery, users must manually maintain a barrel file
 * (`src/modules/index.ts`) that imports and re-exports all modules.
 * When `kick g module` creates a new module, it has to edit this barrel.
 * With auto-discovery, modules are detected automatically — no barrel needed.
 *
 * ## Interaction with HMR
 *
 * When a module file is added, renamed, or deleted:
 * - `handleHotUpdate()` detects the change
 * - The virtual module is invalidated
 * - The next `ssrLoadModule()` call regenerates the virtual module
 *   with the updated module list
 *
 * @module @forinda/kickjs-vite/module-discovery
 */

import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './types'
import { RESOLVED_APP } from './virtual-modules'

/** Regex to detect exported module classes in source files */
const MODULE_CLASS_REGEX =
  /export\s+(?:default\s+)?class\s+(\w+(?:Module))\s*(?:extends|implements|{)/

/** File extensions to scan for modules */
const MODULE_FILE_PATTERN = /\.module\.[tj]sx?$/

/**
 * Discovered module entry — maps a file path to its exported class name.
 *
 * @example
 * ```
 * {
 *   filePath: '/src/modules/users/user.module.ts',
 *   className: 'UserModule'
 * }
 * ```
 */
export interface DiscoveredModule {
  /** Absolute file path */
  filePath: string
  /** Exported class name (e.g., 'UserModule') */
  className: string
}

/**
 * Creates the module auto-discovery plugin.
 *
 * Scans `*.module.ts` files during Vite's transform phase to build a
 * registry of `@Module` classes. The registry is used by the virtual
 * modules plugin to generate auto-imports.
 *
 * @param ctx - Shared plugin context
 * @returns Vite plugin
 */
export function kickjsModuleDiscoveryPlugin(ctx: PluginContext): Plugin {
  /**
   * Registry of discovered modules.
   * Keyed by absolute file path to handle renames and deletions.
   * Stored on the plugin context so the virtual modules plugin can read it.
   */
  const discovered = new Map<string, DiscoveredModule>()
  let server: ViteDevServer | null = null

  // Expose discovered modules on the context for virtual-modules plugin
  ;(ctx as any).discoveredModules = discovered

  return {
    name: 'kickjs:module-discovery',

    configureServer(viteServer) {
      server = viteServer

      // Watch for new/deleted files in the modules directory
      viteServer.watcher.on('add', (filePath) => {
        if (MODULE_FILE_PATTERN.test(filePath)) {
          // File added — it will be processed in transform() when first imported.
          // Invalidate virtual module so it picks up the new file on next request.
          invalidateVirtualApp(viteServer)
        }
      })

      viteServer.watcher.on('unlink', (filePath) => {
        if (discovered.has(filePath)) {
          discovered.delete(filePath)
          invalidateVirtualApp(viteServer)
        }
      })
    },

    /**
     * Transform hook — called for every file Vite processes.
     *
     * We don't actually transform the code (return null), but we use this
     * hook to observe which files contain module classes. This is cheaper
     * than AST parsing — a regex match on the source is sufficient because
     * module files follow a consistent naming pattern (`*.module.ts`).
     */
    transform(code: string, id: string) {
      // Only scan files matching the module pattern
      if (!MODULE_FILE_PATTERN.test(id)) return null
      // Skip node_modules
      if (id.includes('node_modules')) return null

      const match = code.match(MODULE_CLASS_REGEX)
      if (match) {
        const className = match[1]
        const wasNew = !discovered.has(id)
        discovered.set(id, { filePath: id, className })

        if (wasNew && server) {
          // New module discovered — invalidate virtual module
          invalidateVirtualApp(server)
        }
      } else if (discovered.has(id)) {
        // File no longer exports a module class (user removed it)
        discovered.delete(id)
        if (server) {
          invalidateVirtualApp(server)
        }
      }

      // Return null — we don't transform the code, just observe it
      return null
    },

    /**
     * HMR hook — called when a file changes.
     *
     * If a module file changes, we re-scan it and invalidate the virtual
     * module so the next request picks up the changes.
     */
    handleHotUpdate({ file, server: viteServer }) {
      if (!MODULE_FILE_PATTERN.test(file)) return

      // The file will be re-processed in transform() on next import.
      // Invalidate the virtual module so it regenerates with fresh imports.
      invalidateVirtualApp(viteServer)
    },
  }
}

/**
 * Invalidate the virtual:kickjs/app module in Vite's module graph.
 * This forces the next `ssrLoadModule()` call to re-evaluate the
 * virtual module, picking up any new/removed modules.
 */
function invalidateVirtualApp(server: ViteDevServer): void {
  const mod = server.moduleGraph.getModuleById(RESOLVED_APP)
  if (mod) {
    server.moduleGraph.invalidateModule(mod)
  }
}

/**
 * Get the current list of discovered modules.
 * Used by the virtual modules plugin to generate auto-imports.
 */
export function getDiscoveredModules(ctx: PluginContext): DiscoveredModule[] {
  const map = (ctx as any).discoveredModules as Map<string, DiscoveredModule> | undefined
  return map ? [...map.values()] : []
}
