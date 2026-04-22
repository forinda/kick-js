import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Container,
  definePlugin,
  type KickPlugin,
  type DefinePluginOptions,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

interface FlagsConfig {
  provider: string
  ttl: number
}

const baseOptions = (
  overrides: Partial<DefinePluginOptions<FlagsConfig>> = {},
): DefinePluginOptions<FlagsConfig> => ({
  name: 'FlagsPlugin',
  defaults: { ttl: 60_000 },
  build: (config, ctx) => ({
    register(_container) {
      // record the resolved config + ctx so tests can assert on them
      ;(this as Record<string, unknown>).__config = config
      ;(this as Record<string, unknown>).__ctx = ctx
    },
  }),
  ...overrides,
})

describe('definePlugin — bare call (singleton)', () => {
  it('returns a KickPlugin with the definition name', () => {
    const FlagsPlugin = definePlugin(baseOptions())
    const plugin = FlagsPlugin({ provider: 'launchDarkly' })
    expect(plugin.name).toBe('FlagsPlugin')
  })

  it('merges defaults under caller overrides', () => {
    const FlagsPlugin = definePlugin(baseOptions())
    const plugin = FlagsPlugin({ provider: 'split.io', ttl: 10_000 }) as KickPlugin & {
      __config?: FlagsConfig
    }
    plugin.register?.(Container.create())
    expect(plugin.__config).toEqual({ provider: 'split.io', ttl: 10_000 })
  })

  it('uses defaults when caller omits a field', () => {
    const FlagsPlugin = definePlugin(baseOptions())
    const plugin = FlagsPlugin({ provider: 'launchDarkly' }) as KickPlugin & {
      __config?: FlagsConfig
    }
    plugin.register?.(Container.create())
    expect(plugin.__config).toEqual({ provider: 'launchDarkly', ttl: 60_000 })
  })

  it('passes BuildContext with name + scoped=false', () => {
    const FlagsPlugin = definePlugin(baseOptions())
    const plugin = FlagsPlugin({ provider: 'x' }) as KickPlugin & {
      __ctx?: { name: string; scoped: boolean }
    }
    plugin.register?.(Container.create())
    expect(plugin.__ctx).toEqual({ name: 'FlagsPlugin', scoped: false })
  })
})

describe('definePlugin — .scoped()', () => {
  it('namespaces the instance name as `${defName}:${scope}`', () => {
    const QueuePlugin = definePlugin<{ workers: number }>({
      name: 'QueuePlugin',
      defaults: { workers: 1 },
      build: () => ({}),
    })
    const emails = QueuePlugin.scoped('emails', { workers: 3 })
    const webhooks = QueuePlugin.scoped('webhooks', { workers: 1 })
    expect(emails.name).toBe('QueuePlugin:emails')
    expect(webhooks.name).toBe('QueuePlugin:webhooks')
  })

  it('passes BuildContext with scoped=true and the composed name', () => {
    let captured: { name: string; scoped: boolean } | undefined
    const QueuePlugin = definePlugin<{ workers: number }>({
      name: 'QueuePlugin',
      defaults: { workers: 1 },
      build: (_config, ctx) => {
        captured = ctx
        return {}
      },
    })
    QueuePlugin.scoped('emails', { workers: 3 })
    expect(captured).toEqual({ name: 'QueuePlugin:emails', scoped: true })
  })

  it('produces independent KickPlugin objects per scope', () => {
    const QueuePlugin = definePlugin<{ workers: number }>({
      name: 'QueuePlugin',
      defaults: { workers: 1 },
      build: () => ({}),
    })
    const a = QueuePlugin.scoped('emails', { workers: 3 })
    const b = QueuePlugin.scoped('webhooks', { workers: 1 })
    expect(a).not.toBe(b)
  })
})

describe('definePlugin — .async()', () => {
  it('defers config resolution until onReady fires', async () => {
    const events: string[] = []
    const FlagsPlugin = definePlugin<{ provider: string }>({
      name: 'FlagsPlugin',
      build: (config) => ({
        register() {
          events.push(`register:${config.provider}`)
        },
        onReady() {
          events.push(`onReady:${config.provider}`)
        },
      }),
    })

    const container = Container.create()
    const plugin = FlagsPlugin.async({
      useFactory: () => ({ provider: 'launchDarkly' }),
    })

    // Outer plugin exists immediately, inner build is deferred.
    expect(plugin.name).toBe('FlagsPlugin')
    expect(events).toEqual([])

    await plugin.onReady?.(container)
    expect(events).toEqual(['register:launchDarkly', 'onReady:launchDarkly'])
  })

  it('resolves inject tokens through the container before invoking useFactory', async () => {
    const FAKE_TOKEN = Symbol('FakeToken')
    let injected: unknown
    const FlagsPlugin = definePlugin<{ url: string }>({
      name: 'FlagsPlugin',
      build: (config) => ({
        onReady() {
          injected = config.url
        },
      }),
    })

    const container = Container.create()
    container.registerInstance(FAKE_TOKEN, { url: 'https://flags.test' })

    const plugin = FlagsPlugin.async({
      inject: [FAKE_TOKEN],
      useFactory: (cfg: { url: string }) => ({ url: cfg.url }),
    })

    await plugin.onReady?.(container)
    expect(injected).toBe('https://flags.test')
  })

  it('caches the inner plugin between onReady and shutdown', async () => {
    let buildCount = 0
    let shutdownCalls = 0
    const FlagsPlugin = definePlugin<{ provider: string }>({
      name: 'FlagsPlugin',
      build: () => {
        buildCount++
        return {
          shutdown() {
            shutdownCalls++
          },
        }
      },
    })

    const container = Container.create()
    const plugin = FlagsPlugin.async({
      useFactory: () => ({ provider: 'x' }),
    })

    await plugin.onReady?.(container)
    await plugin.shutdown?.()

    expect(buildCount).toBe(1)
    expect(shutdownCalls).toBe(1)
  })
})

describe('definePlugin — metadata exposure', () => {
  it('exposes a frozen `definition` for tooling', () => {
    const FlagsPlugin = definePlugin({
      ...baseOptions(),
      version: '1.0.0',
      requires: { kickjs: '^3.2.0' },
    })
    expect(FlagsPlugin.definition.name).toBe('FlagsPlugin')
    expect(FlagsPlugin.definition.version).toBe('1.0.0')
    expect(FlagsPlugin.definition.requires).toEqual({ kickjs: '^3.2.0' })
    expect(Object.isFrozen(FlagsPlugin.definition)).toBe(true)
  })
})
