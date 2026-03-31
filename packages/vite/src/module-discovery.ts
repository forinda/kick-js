import type { Plugin } from 'vite'
import type { PluginContext } from './context'
import { invalidateVirtualModules } from './virtual-modules'

/** Regex patterns to detect KickJS decorators in source code */
const DECORATOR_PATTERNS: Array<{ pattern: RegExp; kind: string }> = [
  { pattern: /@Controller\s*\(/, kind: 'controller' },
  { pattern: /@Service\s*\(/, kind: 'service' },
  { pattern: /@Repository\s*\(/, kind: 'repository' },
  { pattern: /@Injectable\s*\(/, kind: 'injectable' },
  { pattern: /@Component\s*\(/, kind: 'component' },
]

/** Check if a file imports from KickJS packages */
function hasKickJSImport(code: string): boolean {
  return (
    code.includes('@forinda/kickjs') ||
    code.includes('@forinda/kickjs-core') ||
    code.includes('@forinda/kickjs-http')
  )
}

/**
 * Module discovery plugin — detects @Controller, @Service, etc. decorators
 * during Vite's transform phase and registers discovered modules.
 *
 * When a new decorated module is found, virtual modules are invalidated
 * so they regenerate with the new imports.
 */
export function kickjsModuleDiscovery(ctx: PluginContext): Plugin {
  return {
    name: 'kickjs:module-discovery',

    transform(code, id) {
      // Only scan TypeScript files in the user's project
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return
      if (id.includes('node_modules')) return
      if (!hasKickJSImport(code)) return

      const kinds = new Set<string>()
      for (const { pattern, kind } of DECORATOR_PATTERNS) {
        if (pattern.test(code)) {
          kinds.add(kind)
        }
      }

      if (kinds.size > 0) {
        const relativePath = id.startsWith(ctx.root + '/') ? id.slice(ctx.root.length + 1) : id
        const existing = ctx.discoveredModules.get(relativePath)
        const changed =
          !existing || existing.size !== kinds.size || [...kinds].some((k) => !existing.has(k))

        if (changed) {
          ctx.discoveredModules.set(relativePath, kinds)
          invalidateVirtualModules(ctx)
        }
      }

      // Pass through — we don't modify the code
      return undefined
    },
  }
}
