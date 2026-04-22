import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Container,
  defineAdapter,
  type AppAdapter,
  type AdapterContext,
  type DefineAdapterOptions,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

interface TenantConfig {
  strategy: 'header' | 'subdomain'
  required: boolean
}

const baseOptions = (
  overrides: Partial<DefineAdapterOptions<TenantConfig>> = {},
): DefineAdapterOptions<TenantConfig> => ({
  name: 'TenantAdapter',
  defaults: { strategy: 'header', required: true },
  build: (config, ctx) => ({
    beforeStart() {
      ;(this as Record<string, unknown>).__config = config
      ;(this as Record<string, unknown>).__ctx = ctx
    },
  }),
  ...overrides,
})

const fakeAdapterCtx = (): AdapterContext =>
  ({
    container: Container.create(),
    app: {} as never,
    env: 'test',
    isProduction: false,
  }) as AdapterContext

describe('defineAdapter — bare call (singleton)', () => {
  it('returns an AppAdapter with the definition name', () => {
    const TenantAdapter = defineAdapter(baseOptions())
    const adapter = TenantAdapter({ strategy: 'subdomain', required: false })
    expect(adapter.name).toBe('TenantAdapter')
  })

  it('merges defaults under caller overrides', async () => {
    const TenantAdapter = defineAdapter(baseOptions())
    const adapter = TenantAdapter({ strategy: 'subdomain' }) as AppAdapter & {
      __config?: TenantConfig
    }
    await adapter.beforeStart?.(fakeAdapterCtx())
    expect(adapter.__config).toEqual({ strategy: 'subdomain', required: true })
  })

  it('passes BuildContext with name + scoped=false', async () => {
    const TenantAdapter = defineAdapter(baseOptions())
    const adapter = TenantAdapter({ strategy: 'header' }) as AppAdapter & {
      __ctx?: { name: string; scoped: boolean }
    }
    await adapter.beforeStart?.(fakeAdapterCtx())
    expect(adapter.__ctx).toEqual({ name: 'TenantAdapter', scoped: false })
  })
})

describe('defineAdapter — .scoped()', () => {
  it('namespaces the instance name as `${defName}:${scope}`', () => {
    const TenantAdapter = defineAdapter(baseOptions())
    const eu = TenantAdapter.scoped('shard-eu', { strategy: 'header' })
    const us = TenantAdapter.scoped('shard-us', { strategy: 'header' })
    expect(eu.name).toBe('TenantAdapter:shard-eu')
    expect(us.name).toBe('TenantAdapter:shard-us')
  })

  it('passes BuildContext with scoped=true and the composed name', () => {
    let captured: { name: string; scoped: boolean } | undefined
    const TenantAdapter = defineAdapter(baseOptions({
      build: (_config, ctx) => {
        captured = ctx
        return {}
      },
    }))
    TenantAdapter.scoped('shard-eu', { strategy: 'header' })
    expect(captured).toEqual({ name: 'TenantAdapter:shard-eu', scoped: true })
  })
})

describe('defineAdapter — .async()', () => {
  it('defers config resolution until beforeStart fires', async () => {
    const events: string[] = []
    const DbAdapter = defineAdapter<{ url: string }>({
      name: 'DbAdapter',
      build: (config) => ({
        beforeStart() {
          events.push(`beforeStart:${config.url}`)
        },
        afterStart() {
          events.push(`afterStart:${config.url}`)
        },
      }),
    })

    const adapter = DbAdapter.async({
      useFactory: () => ({ url: 'postgres://test' }),
    })

    expect(adapter.name).toBe('DbAdapter')
    expect(events).toEqual([])

    await adapter.beforeStart?.(fakeAdapterCtx())
    expect(events).toEqual(['beforeStart:postgres://test'])

    await adapter.afterStart?.(fakeAdapterCtx())
    expect(events).toEqual(['beforeStart:postgres://test', 'afterStart:postgres://test'])
  })

  it('resolves inject tokens through the container before invoking useFactory', async () => {
    const CONFIG_TOKEN = Symbol('Config')
    let injected: unknown
    const DbAdapter = defineAdapter<{ url: string }>({
      name: 'DbAdapter',
      build: (config) => ({
        beforeStart() {
          injected = config.url
        },
      }),
    })

    const ctx = fakeAdapterCtx()
    ctx.container.registerInstance(CONFIG_TOKEN, { url: 'postgres://injected' })

    const adapter = DbAdapter.async({
      inject: [CONFIG_TOKEN],
      useFactory: (cfg: { url: string }) => ({ url: cfg.url }),
    })

    await adapter.beforeStart?.(ctx)
    expect(injected).toBe('postgres://injected')
  })

  it('routes shutdown + onHealthCheck through the inner adapter', async () => {
    const calls: string[] = []
    const DbAdapter = defineAdapter<{ url: string }>({
      name: 'DbAdapter',
      build: () => ({
        shutdown() {
          calls.push('shutdown')
        },
        onHealthCheck: async () => {
          calls.push('health')
          return { name: 'DbAdapter', status: 'up' as const }
        },
      }),
    })

    const adapter = DbAdapter.async({
      useFactory: () => ({ url: 'postgres://test' }),
    })

    await adapter.beforeStart?.(fakeAdapterCtx())
    const health = await adapter.onHealthCheck?.()
    await adapter.shutdown?.()

    expect(health).toEqual({ name: 'DbAdapter', status: 'up' })
    expect(calls).toEqual(['health', 'shutdown'])
  })

  it('returns a default-up health response when beforeStart has not fired yet', async () => {
    const DbAdapter = defineAdapter<{ url: string }>({
      name: 'DbAdapter',
      build: () => ({}),
    })
    const adapter = DbAdapter.async({ useFactory: () => ({ url: 'x' }) })
    const health = await adapter.onHealthCheck?.()
    expect(health).toEqual({ name: 'DbAdapter', status: 'up' })
  })
})

describe('defineAdapter — NestJS-style aliases', () => {
  it('forRoot is the bare call', () => {
    const TenantAdapter = defineAdapter(baseOptions())
    expect(TenantAdapter.forRoot).toBe(TenantAdapter)
  })

  it('forFeature is .scoped', () => {
    const TenantAdapter = defineAdapter(baseOptions())
    expect(TenantAdapter.forFeature).toBe(TenantAdapter.scoped)
  })

  it('forRootAsync is .async', () => {
    const TenantAdapter = defineAdapter(baseOptions())
    expect(TenantAdapter.forRootAsync).toBe(TenantAdapter.async)
  })
})

describe('defineAdapter — metadata exposure', () => {
  it('exposes a frozen `definition` for tooling', () => {
    const TenantAdapter = defineAdapter({
      ...baseOptions(),
      version: '2.1.0',
      requires: { kickjs: '^3.2.0' },
    })
    expect(TenantAdapter.definition.name).toBe('TenantAdapter')
    expect(TenantAdapter.definition.version).toBe('2.1.0')
    expect(Object.isFrozen(TenantAdapter.definition)).toBe(true)
  })
})
