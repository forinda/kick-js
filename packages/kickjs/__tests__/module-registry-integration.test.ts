import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Application, defineModule, definePlugin, type ModuleRegistry } from '../src/index'

describe('Application — bootstrap setup(registry) callback', () => {
  it('runs the user setup callback and threads its mounts through the loader', async () => {
    // Track register() calls on each module — both fire iff both went
    // through the loader's mount path. Avoids poking Express router
    // internals (shape changes between minor versions).
    const registered: string[] = []
    const Hello = defineModule({
      name: 'Hello',
      build: () => ({
        register: () => {
          registered.push('Hello')
        },
        routes: () => null,
      }),
    })
    const Admin = defineModule({
      name: 'Admin',
      build: () => ({
        register: () => {
          registered.push('Admin')
        },
        routes: () => null,
      }),
    })

    let setupCalled = 0
    const app = new Application({
      modules: [Hello()],
      setup(registry) {
        setupCalled++
        registry.mount(Admin())
      },
    })

    await app.setup()

    expect(setupCalled).toBe(1)
    expect(registered).toEqual(['Hello', 'Admin'])
  })

  it('passes the same registry to plugin.setup() and bootstrap.setup() with plugin running first', async () => {
    const callOrder: string[] = []
    const registered: string[] = []
    const PluginMod = defineModule({
      name: 'PluginMod',
      build: () => ({
        register: () => {
          registered.push('PluginMod')
        },
        routes: () => null,
      }),
    })
    const UserMod = defineModule({
      name: 'UserMod',
      build: () => ({
        register: () => {
          registered.push('UserMod')
        },
        routes: () => null,
      }),
    })

    const TestPlugin = definePlugin({
      name: 'TestPlugin',
      build: () => ({
        setup(registry: ModuleRegistry) {
          callOrder.push('plugin')
          registry.mount(PluginMod())
        },
      }),
    })

    const app = new Application({
      modules: [],
      plugins: [TestPlugin()],
      setup(registry) {
        callOrder.push('bootstrap')
        registry.mount(UserMod())
      },
    })

    await app.setup()

    // Plugin runs before bootstrap setup so plugin modules mount earlier.
    expect(callOrder).toEqual(['plugin', 'bootstrap'])
    expect(registered).toEqual(['PluginMod', 'UserMod'])
  })

  it('skips setup() entirely when not provided — backwards compatible', async () => {
    const Hello = defineModule({
      name: 'Hello',
      build: () => ({ routes: () => null }),
    })
    const app = new Application({ modules: [Hello()] })
    await expect(app.setup()).resolves.toBeUndefined()
  })

  it('plugin.setup() can register modules conditionally based on captured config', async () => {
    interface PluginCfg {
      tenants: string[]
    }
    const TenantTpl = defineModule({
      name: 'TenantTpl',
      build: () => ({ routes: () => null }),
    })

    const MultiTenant = definePlugin<PluginCfg>({
      name: 'MultiTenant',
      defaults: { tenants: [] },
      build: (config) => ({
        setup(registry) {
          for (const tenant of config.tenants) {
            registry.mount(TenantTpl())
            // tag the registration via a side channel so the test
            // can verify ordering / count
            ;(registry as { __seen?: string[] }).__seen ??= []
            ;(registry as { __seen?: string[] }).__seen!.push(tenant)
          }
        },
      }),
    })

    const seen: string[] = []
    const probe: ModuleRegistry & { __seen: string[] } = {
      __seen: seen,
      mount: () => {
        // no-op probe — we only care that setup() was called with our
        // registry shape and emitted the expected entries.
      },
    } as ModuleRegistry & { __seen: string[] }

    // Run the plugin's setup() directly to assert config threading;
    // Application's bootstrap covers the integration path elsewhere.
    const plugin = MultiTenant({ tenants: ['acme', 'globex'] })
    plugin.setup?.(probe)
    expect(probe.__seen).toEqual(['acme', 'globex'])
  })
})
