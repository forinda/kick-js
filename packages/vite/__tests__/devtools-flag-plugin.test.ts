// Coverage for the build-time DevTools flag plugin. Tests exercise:
//   - Default value resolution (dev=true, build=false)
//   - Explicit `enabled` override wins over env
//   - `KICKJS_DEVTOOLS=0|1|true|false` env override wins over command
//   - Custom flagName lands at the right key
//   - The plugin is registered in `kickjsVitePlugin()` by default,
//     and skipped when `devtools: false` is passed.

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import type { Plugin } from 'vite'

import { devtoolsFlagPlugin, resolveDevtoolsFlag, kickjsVitePlugin } from '../src/index'

// ── Helpers ───────────────────────────────────────────────────────────

interface ConfigEnvLike {
  command: 'serve' | 'build'
  mode: string
}

function callConfig(plugin: Plugin, env: ConfigEnvLike): { define?: Record<string, string> } {
  const hook = plugin.config
  if (typeof hook !== 'function') return {}
  const result = (
    hook as unknown as (
      cfg: Record<string, unknown>,
      env: ConfigEnvLike,
    ) => { define?: Record<string, string> }
  )({}, env)
  return result ?? {}
}

const findPlugin = (plugins: Plugin[], name: string): Plugin | undefined =>
  plugins.find((p) => p.name === name)

// ── resolveDevtoolsFlag ───────────────────────────────────────────────

describe('resolveDevtoolsFlag', () => {
  const originalEnv = process.env.KICKJS_DEVTOOLS
  const originalNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.KICKJS_DEVTOOLS
    else process.env.KICKJS_DEVTOOLS = originalEnv
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  })

  it('explicit `enabled: true` wins over everything', () => {
    process.env.KICKJS_DEVTOOLS = '0'
    expect(resolveDevtoolsFlag({ enabled: true }, { command: 'build', mode: 'production' })).toBe(
      true,
    )
  })

  it('explicit `enabled: false` wins over everything', () => {
    process.env.KICKJS_DEVTOOLS = '1'
    expect(resolveDevtoolsFlag({ enabled: false }, { command: 'serve', mode: 'development' })).toBe(
      false,
    )
  })

  it('KICKJS_DEVTOOLS=1 wins over command=build', () => {
    process.env.KICKJS_DEVTOOLS = '1'
    expect(resolveDevtoolsFlag({}, { command: 'build', mode: 'production' })).toBe(true)
  })

  it('KICKJS_DEVTOOLS=true also enables', () => {
    process.env.KICKJS_DEVTOOLS = 'true'
    expect(resolveDevtoolsFlag({}, { command: 'build', mode: 'production' })).toBe(true)
  })

  it('KICKJS_DEVTOOLS=0 wins over command=serve', () => {
    process.env.KICKJS_DEVTOOLS = '0'
    expect(resolveDevtoolsFlag({}, { command: 'serve', mode: 'development' })).toBe(false)
  })

  it('KICKJS_DEVTOOLS=false also disables', () => {
    process.env.KICKJS_DEVTOOLS = 'false'
    expect(resolveDevtoolsFlag({}, { command: 'serve', mode: 'development' })).toBe(false)
  })

  it('command=serve → true (no env override)', () => {
    delete process.env.KICKJS_DEVTOOLS
    expect(resolveDevtoolsFlag({}, { command: 'serve', mode: 'development' })).toBe(true)
  })

  it('command=build → false (no env override)', () => {
    delete process.env.KICKJS_DEVTOOLS
    expect(resolveDevtoolsFlag({}, { command: 'build', mode: 'production' })).toBe(false)
  })

  it('falls back to NODE_ENV when no env arg is given (test runner / standalone callers)', () => {
    delete process.env.KICKJS_DEVTOOLS
    process.env.NODE_ENV = 'production'
    expect(resolveDevtoolsFlag()).toBe(false)
    process.env.NODE_ENV = 'development'
    expect(resolveDevtoolsFlag()).toBe(true)
  })
})

// ── devtoolsFlagPlugin direct ─────────────────────────────────────────

describe('devtoolsFlagPlugin', () => {
  beforeEach(() => {
    delete process.env.KICKJS_DEVTOOLS
  })

  it('registers __KICKJS_DEVTOOLS__ as JSON-encoded literal in serve', () => {
    const result = callConfig(devtoolsFlagPlugin(), { command: 'serve', mode: 'development' })
    expect(result.define).toEqual({ __KICKJS_DEVTOOLS__: 'true' })
  })

  it('registers false in build mode', () => {
    const result = callConfig(devtoolsFlagPlugin(), { command: 'build', mode: 'production' })
    expect(result.define).toEqual({ __KICKJS_DEVTOOLS__: 'false' })
  })

  it('honors a custom flagName', () => {
    const result = callConfig(devtoolsFlagPlugin({ flagName: '__APP_DEVTOOLS__' }), {
      command: 'serve',
      mode: 'development',
    })
    expect(result.define).toEqual({ __APP_DEVTOOLS__: 'true' })
  })

  it('explicit enabled overrides command', () => {
    const result = callConfig(devtoolsFlagPlugin({ enabled: false }), {
      command: 'serve',
      mode: 'development',
    })
    expect(result.define).toEqual({ __KICKJS_DEVTOOLS__: 'false' })
  })

  it('plugin name is stable for inspection / overrides', () => {
    expect(devtoolsFlagPlugin().name).toBe('kickjs:devtools-flag')
  })
})

// ── Wiring into kickjsVitePlugin ──────────────────────────────────────

describe('kickjsVitePlugin — devtools flag wiring', () => {
  it('registers the devtools-flag plugin by default', () => {
    const plugins = kickjsVitePlugin()
    expect(findPlugin(plugins, 'kickjs:devtools-flag')).toBeDefined()
  })

  it('skips the plugin when devtools: false is passed', () => {
    const plugins = kickjsVitePlugin({ devtools: false })
    expect(findPlugin(plugins, 'kickjs:devtools-flag')).toBeUndefined()
  })

  it('forwards explicit enabled option through to the registered plugin', () => {
    const plugins = kickjsVitePlugin({ devtools: { enabled: false } })
    const plugin = findPlugin(plugins, 'kickjs:devtools-flag')
    expect(plugin).toBeDefined()
    const result = callConfig(plugin!, { command: 'serve', mode: 'development' })
    expect(result.define).toEqual({ __KICKJS_DEVTOOLS__: 'false' })
  })

  it('forwards custom flagName through to the registered plugin', () => {
    const plugins = kickjsVitePlugin({ devtools: { flagName: '__MY_FLAG__' } })
    const plugin = findPlugin(plugins, 'kickjs:devtools-flag')
    const result = callConfig(plugin!, { command: 'build', mode: 'production' })
    expect(result.define).toEqual({ __MY_FLAG__: 'false' })
  })
})
