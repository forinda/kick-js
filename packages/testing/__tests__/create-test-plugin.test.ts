import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { createTestPlugin, testPlugin } from '../src/index'
import {
  Container,
  defineContextDecorator,
  type AppAdapter,
  type AppModule,
  type AppModuleClass,
  type KickPlugin,
} from '@forinda/kickjs'

const FLAGS_TOKEN = Symbol('FLAGS')

const flagsPlugin = (initial: Record<string, boolean>): KickPlugin => ({
  name: 'FlagsPlugin',
  register(container) {
    container.registerInstance(FLAGS_TOKEN, initial)
  },
})

describe('createTestPlugin — defaults', () => {
  it('runs plugin.register against a fresh isolated container', async () => {
    const harness = await createTestPlugin(flagsPlugin({ beta: true }))
    expect(harness.container.resolve(FLAGS_TOKEN)).toEqual({ beta: true })
  })

  it('isolated container does not leak into Container.getInstance()', async () => {
    Container.reset()
    const baseline = Container.getInstance()
    const ISOLATION_TOKEN = Symbol('IsolationProbe')
    const probePlugin: KickPlugin = {
      name: 'IsolationProbe',
      register(container) {
        container.registerInstance(ISOLATION_TOKEN, 'harness-only')
      },
    }
    const harness = await createTestPlugin(probePlugin)
    expect(harness.container).not.toBe(baseline)
    // The token registered on the harness container must not be visible
    // on the global singleton — that is the entire point of isolation.
    expect(harness.container.resolve(ISOLATION_TOKEN)).toBe('harness-only')
    expect(() => baseline.resolve(ISOLATION_TOKEN)).toThrow()
  })

  it('exposes the plugin instance directly for assertions', async () => {
    const plugin = flagsPlugin({})
    const harness = await createTestPlugin(plugin)
    expect(harness.plugin).toBe(plugin)
  })
})

describe('createTestPlugin — skipRegister opt-out', () => {
  it('does not auto-call register when skipRegister: true', async () => {
    const plugin = flagsPlugin({ beta: true })
    const harness = await createTestPlugin(plugin, { skipRegister: true })
    expect(() => harness.container.resolve(FLAGS_TOKEN)).toThrow()
    // Caller can register manually after asserting the empty state.
    plugin.register?.(harness.container)
    expect(harness.container.resolve(FLAGS_TOKEN)).toEqual({ beta: true })
  })
})

describe('createTestPlugin — lifecycle invokers', () => {
  it('callOnReady forwards to plugin.onReady with the harness container', async () => {
    let receivedContainer: Container | undefined
    const plugin: KickPlugin = {
      name: 'OnReadyPlugin',
      onReady(container) {
        receivedContainer = container
      },
    }
    const harness = await createTestPlugin(plugin)
    await harness.callOnReady()
    expect(receivedContainer).toBe(harness.container)
  })

  it('shutdown forwards to plugin.shutdown', async () => {
    const events: string[] = []
    const plugin: KickPlugin = {
      name: 'ShutdownPlugin',
      shutdown() {
        events.push('shutdown')
      },
    }
    const harness = await createTestPlugin(plugin)
    await harness.shutdown()
    expect(events).toEqual(['shutdown'])
  })

  it('callOnReady / shutdown are no-ops when the plugin omits the hook', async () => {
    const harness = await createTestPlugin({ name: 'BarePlugin' })
    await expect(harness.callOnReady()).resolves.toBeUndefined()
    await expect(harness.shutdown()).resolves.toBeUndefined()
  })
})

describe('createTestPlugin — collection getters', () => {
  it('returns whatever the plugin exposes via modules() / adapters() / middleware()', async () => {
    class FakeModule implements AppModule {
      register() {}
      routes() {
        return null
      }
    }
    const fakeAdapter: AppAdapter = { name: 'FakeAdapter' }
    const fakeMiddleware = () => {}

    const plugin: KickPlugin = {
      name: 'BundlePlugin',
      modules: () => [FakeModule],
      adapters: () => [fakeAdapter],
      middleware: () => [fakeMiddleware],
    }

    const harness = await createTestPlugin(plugin)
    expect(harness.modules()).toEqual<AppModuleClass[]>([FakeModule])
    expect(harness.adapters()).toEqual([fakeAdapter])
    expect(harness.middleware()).toEqual([fakeMiddleware])
  })

  it('returns empty arrays when the plugin omits the collection hooks', async () => {
    const harness = await createTestPlugin({ name: 'EmptyPlugin' })
    expect(harness.modules()).toEqual([])
    expect(harness.adapters()).toEqual([])
    expect(harness.middleware()).toEqual([])
    expect(harness.contributors()).toEqual([])
  })
})

describe('createTestPlugin — runContributors', () => {
  it('runs every contributor the plugin ships against the fake context', async () => {
    const LoadFlags = defineContextDecorator({
      key: 'flags',
      resolve: () => ({ beta: true }),
    })

    const plugin: KickPlugin = {
      name: 'FlagsPlugin',
      contributors: () => [LoadFlags.registration],
    }

    const harness = await createTestPlugin(plugin)
    const ctx = harness.makeContext()
    await harness.runContributors(ctx)
    expect(ctx.get('flags')).toEqual({ beta: true })
  })

  it('honours dependsOn ordering between contributors a single plugin ships', async () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })

    const LoadProject = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant'],
      resolve: (ctx) => {
        const tenant = ctx.get('tenant') as { id: string }
        return { id: 'p-1', tenantId: tenant.id }
      },
    })

    const plugin: KickPlugin = {
      name: 'WorkspacePlugin',
      // Declared in reverse dependency order to confirm topo-sort runs.
      contributors: () => [LoadProject.registration, LoadTenant.registration],
    }

    const harness = await createTestPlugin(plugin)
    const ctx = harness.makeContext()
    await harness.runContributors(ctx)

    expect(ctx.get('project')).toEqual({ id: 'p-1', tenantId: 't-1' })
    expect(ctx.get('tenant')).toEqual({ id: 't-1' })
  })

  it('makeContext seeds the metadata Map with the provided initial values', async () => {
    const harness = await createTestPlugin({ name: 'NoContribPlugin' })
    const ctx = harness.makeContext({ tenant: { id: 't-9' } })
    expect(ctx.get('tenant')).toEqual({ id: 't-9' })
    expect(ctx.requestId).toBe('test-req')
  })

  it('contributor deps resolve through the harness container', async () => {
    interface FlagSource {
      load(): Record<string, boolean>
    }
    const SOURCE_TOKEN = Symbol('FlagSource')

    const LoadFlags = defineContextDecorator({
      key: 'flags',
      deps: { source: SOURCE_TOKEN },
      resolve: (_ctx, { source }) => (source as FlagSource).load(),
    })

    const plugin: KickPlugin = {
      name: 'FlagsPlugin',
      register(container) {
        container.registerInstance(SOURCE_TOKEN, { load: () => ({ beta: true, ga: false }) })
      },
      contributors: () => [LoadFlags.registration],
    }

    const harness = await createTestPlugin(plugin)
    const ctx = harness.makeContext()
    await harness.runContributors(ctx)
    expect(ctx.get('flags')).toEqual({ beta: true, ga: false })
  })
})

describe('createTestPlugin — testPlugin alias', () => {
  it('exports testPlugin as an alias of createTestPlugin', () => {
    expect(testPlugin).toBe(createTestPlugin)
  })
})
