/**
 * HMR plugin for KickJS — selective container invalidation when source
 * files change, with debounced batching for bulk operations.
 *
 * ## How It Works
 *
 * 1. During `transform()`, the plugin scans for decorator patterns
 *    (`@Service`, `@Controller`, etc.) and maps file paths to DI token names
 * 2. When a file changes (`handleHotUpdate()`), the plugin:
 *    - Looks up which DI tokens are defined in that file
 *    - Calls `container.invalidate(token)` for each (which walks the dep graph)
 *    - Invalidates the virtual module so `ssrLoadModule()` returns fresh code
 *    - Sends a custom HMR event (`kickjs:hmr`) so DevTools/Swagger can react
 * 3. Changes are **debounced** (150ms) so `kick g module` creating 10+ files
 *    emits ONE invalidation batch, not 10 separate events
 *
 * ## Interaction with Reactive Container
 *
 * `container.invalidate(token)` (from Step 3) does:
 * - Clears the cached instance for that token
 * - Walks the dependency graph to find dependents
 * - Invalidates all dependents recursively
 * - Emits batched `onChange()` events to all subscribers (Swagger, DevTools, etc.)
 *
 * ## Detection Strategy
 *
 * Uses regex patterns (not AST) for speed. This is the same approach
 * TanStack Start uses (`KindDetectionPatterns` in their compiler).
 * It's fast because:
 * - Only runs on files that actually contain decorator patterns
 * - No Babel/SWC parsing needed
 * - False positives are harmless (extra invalidation is safe)
 *
 * @see bench-mark/tanstack-router-analysis.md — Detection pattern origin
 * @see v3/plan.md Step 5 — Design rationale
 *
 * @module @forinda/kickjs-vite/hmr-plugin
 */

import type { Plugin, ViteDevServer } from 'vite'
import type { PluginContext } from './types'
import { RESOLVED_APP } from './virtual-modules'

/**
 * Regex patterns that detect KickJS decorator usage in source files.
 * Matches `@Service()`, `@Controller('/path')`, `@Repository()`, etc.
 * followed by an exported class declaration.
 *
 * Pattern: decorator → optional whitespace → export? class ClassName
 */
const DECORATOR_CLASS_REGEX =
  /@(?:Service|Controller|Repository|Injectable|Component)\s*\([^)]*\)\s*\n?\s*(?:export\s+)?class\s+(\w+)/g

/** Debounce time for batching multiple file changes into one invalidation */
const DEBOUNCE_MS = 150

/**
 * Creates the HMR selective invalidation plugin.
 *
 * Tracks which DI tokens are defined in which files, then selectively
 * invalidates only the affected tokens (and their dependents) when
 * those files change. Much faster than a full Container.reset().
 *
 * @param ctx - Shared plugin context
 * @returns Vite plugin
 */
export function kickjsHmrPlugin(ctx: PluginContext): Plugin {
  /**
   * Maps file paths to the DI token names defined in them.
   * Built up during transform(), read during handleHotUpdate().
   *
   * @example
   * ```
   * '/src/modules/users/user.service.ts' → ['UserService']
   * '/src/modules/users/user.controller.ts' → ['UserController']
   * ```
   */
  const fileTokenMap = new Map<string, string[]>()

  /** Pending tokens to invalidate (accumulated during debounce window) */
  let pendingTokens = new Set<string>()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  return {
    name: 'kickjs:hmr',

    /**
     * Transform hook — scans source files for decorator patterns.
     *
     * Doesn't modify the code (returns null), just records which
     * DI tokens are defined in each file. This mapping is used by
     * `handleHotUpdate()` to determine what to invalidate.
     */
    transform(code: string, id: string) {
      // Skip non-TypeScript/JavaScript files and node_modules
      if (!/\.[tj]sx?$/.test(id)) return null
      if (id.includes('node_modules')) return null

      // Quick bail-out: skip files that don't contain any decorator keywords
      if (
        !code.includes('@Service') &&
        !code.includes('@Controller') &&
        !code.includes('@Repository') &&
        !code.includes('@Injectable') &&
        !code.includes('@Component')
      ) {
        // If file was previously tracked but decorators were removed, clean up
        if (fileTokenMap.has(id)) {
          fileTokenMap.delete(id)
        }
        return null
      }

      // Extract class names from decorator patterns
      const tokens: string[] = []
      let match: RegExpExecArray | null
      // Reset regex lastIndex for reuse across files
      DECORATOR_CLASS_REGEX.lastIndex = 0
      while ((match = DECORATOR_CLASS_REGEX.exec(code)) !== null) {
        tokens.push(match[1])
      }

      if (tokens.length > 0) {
        fileTokenMap.set(id, tokens)
      } else if (fileTokenMap.has(id)) {
        fileTokenMap.delete(id)
      }

      return null
    },

    /**
     * HMR hook — called when a file changes in dev mode.
     *
     * If the changed file contains KickJS decorated classes:
     * 1. Accumulate the affected tokens in the debounce buffer
     * 2. After 150ms of quiet, flush: invalidate all tokens at once
     * 3. Invalidate the virtual module for fresh `ssrLoadModule()` response
     * 4. Send ONE `kickjs:hmr` event to the client (DevTools, Swagger UI)
     *
     * The 150ms debounce is critical for `kick g module` which creates
     * 10+ files in rapid succession. Without debouncing, each file would
     * trigger a separate invalidation cycle.
     *
     * Returns an empty array to tell Vite we handled the update
     * (prevents Vite's default full-page reload for these files).
     */
    handleHotUpdate({ file, server }) {
      const tokens = fileTokenMap.get(file)
      if (!tokens || tokens.length === 0) return

      // Accumulate tokens for batched invalidation
      for (const t of tokens) pendingTokens.add(t)

      // Debounce: flush after 150ms of quiet
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        flushInvalidation(server, pendingTokens)
        pendingTokens = new Set()
      }, DEBOUNCE_MS)

      // Tell Vite we handled it — don't do default full-page reload
      return []
    },
  }
}

/**
 * Flush accumulated token invalidations.
 *
 * Called after the debounce window closes. Performs:
 * 1. Container invalidation (clears instances + walks dependency graph)
 * 2. Virtual module invalidation (forces ssrLoadModule to re-evaluate)
 * 3. HMR event broadcast (notifies DevTools, Swagger UI, etc.)
 *
 * @param server - Vite dev server
 * @param tokens - Set of DI token names to invalidate
 */
function flushInvalidation(server: ViteDevServer, tokens: Set<string>): void {
  const batch = [...tokens]
  if (batch.length === 0) return

  // 1. Invalidate tokens in the reactive container (if available)
  //    container.invalidate() walks the dependency graph and notifies subscribers
  const container = (globalThis as any).__kickjs_container
  if (container && typeof container.invalidate === 'function') {
    for (const token of batch) {
      container.invalidate(token)
    }
  }

  // 2. Invalidate the virtual module so next ssrLoadModule() re-evaluates
  const vmod = server.moduleGraph.getModuleById(RESOLVED_APP)
  if (vmod) {
    server.moduleGraph.invalidateModule(vmod)
  }

  // 3. Send ONE custom HMR event with the full batch
  //    DevTools dashboard, Swagger UI, and other dev tools can listen:
  //      import.meta.hot?.on('kickjs:hmr', (data) => { ... })
  server.hot.send({
    type: 'custom',
    event: 'kickjs:hmr',
    data: { tokens: batch, timestamp: Date.now() },
  })

  // Log to dev console
  const names = batch.join(', ')
  const label = batch.length === 1 ? '1 token' : `${batch.length} tokens`
  console.log(`  ${green('HMR')} invalidated ${label}: ${names}`)
}

/** ANSI green for terminal output */
function green(text: string): string {
  return `\x1b[32m${text}\x1b[0m`
}
