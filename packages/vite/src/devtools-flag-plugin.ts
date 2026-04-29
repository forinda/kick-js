// `devtoolsFlagPlugin()` — exposes `__KICKJS_DEVTOOLS__` as a build-time
// constant adopters guard their devtools imports behind. Vite/Rollup's
// existing dead-code-elimination strips the gated branch from production
// bundles entirely (including any dynamic `import('@forinda/kickjs-devtools')`
// inside the gate), giving "devtools-in-dev, zero overhead in prod"
// without a babel pass.
//
// Adopter usage:
//
//   const adapters = [/* prod adapters… */]
//   if (__KICKJS_DEVTOOLS__) {
//     const { DevToolsAdapter } = await import('@forinda/kickjs-devtools')
//     adapters.push(DevToolsAdapter({ basePath: '/_debug' }))
//   }
//
//   bootstrap({ adapters, modules: [...] })
//
// Resolution order for the flag's value:
//   1. explicit `enabled` option on the plugin → wins
//   2. `KICKJS_DEVTOOLS=0|1` env var → operator-side override
//   3. Vite `command` — `'serve'` (dev) → true, `'build'` → false.
//      `command` is cleaner than NODE_ENV: Vite passes it explicitly
//      to plugins regardless of how the user set their environment.
//
// The plugin returns a Vite `config` hook that adds the literal under
// `define`. Vite's `define` is a verbatim-substitution map; stringifying
// with JSON.stringify keeps the value a true / false token (no quotes
// would break the parser).

import type { ConfigEnv, Plugin } from 'vite'

export interface DevtoolsFlagOptions {
  /**
   * Force the flag value. When set, environment-based detection is
   * bypassed entirely. Useful for explicit feature gates per build
   * profile.
   *
   * @default `vite command === 'serve'` (true in dev, false in build)
   */
  enabled?: boolean
  /**
   * Override the global name. Default `__KICKJS_DEVTOOLS__`.
   * Useful for adopters who want a project-specific flag name to
   * avoid colliding with another tooling's own globals.
   */
  flagName?: string
}

/**
 * Resolve the build-time devtools flag. Exposed for unit tests +
 * adopters who want to compute the same answer the plugin would.
 */
export function resolveDevtoolsFlag(opts: DevtoolsFlagOptions = {}, env?: ConfigEnv): boolean {
  if (typeof opts.enabled === 'boolean') return opts.enabled
  const envOverride = process.env.KICKJS_DEVTOOLS
  if (envOverride === '1' || envOverride === 'true') return true
  if (envOverride === '0' || envOverride === 'false') return false
  // env may be undefined when callers compute the flag outside a
  // Vite plugin invocation (tests). Fall back to NODE_ENV as a last
  // resort so the resolver still gives a sensible answer.
  if (env) return env.command === 'serve'
  return process.env.NODE_ENV !== 'production'
}

export function devtoolsFlagPlugin(opts: DevtoolsFlagOptions = {}): Plugin {
  const flagName = opts.flagName ?? '__KICKJS_DEVTOOLS__'
  return {
    name: 'kickjs:devtools-flag',
    config(_userConfig, env) {
      const enabled = resolveDevtoolsFlag(opts, env)
      return {
        define: {
          [flagName]: JSON.stringify(enabled),
        },
      }
    },
  }
}
