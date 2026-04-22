import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Application,
  Container,
  MissingMountDepError,
  MountCycleError,
  type AppAdapter,
  type KickPlugin,
} from '../src/index'

beforeEach(() => {
  Container.reset()
})

/**
 * Build a minimal plugin/adapter that records its mount order
 * via the shared trace array. Only the fields relevant to mount-sort
 * (name + dependsOn) are used; everything else is unset.
 */
function tracePlugin(name: string, dependsOn?: readonly string[]): KickPlugin {
  return { name, dependsOn }
}

function traceAdapter(name: string, dependsOn?: readonly string[]): AppAdapter {
  return { name, dependsOn }
}

describe('Application — plugin dependsOn', () => {
  it('mounts plugins in topological order via dependsOn', () => {
    const app = new Application({
      modules: [],
      plugins: [tracePlugin('AuthPlugin', ['TenantPlugin']), tracePlugin('TenantPlugin')],
    })
    // Read sorted plugin order via private field (test-only escape).
    const sortedNames = (app as unknown as { plugins: KickPlugin[] }).plugins.map((p) => p.name)
    expect(sortedNames).toEqual(['TenantPlugin', 'AuthPlugin'])
  })

  it('preserves declaration order for plugins without dependsOn', () => {
    const app = new Application({
      modules: [],
      plugins: [tracePlugin('A'), tracePlugin('B'), tracePlugin('C')],
    })
    const sortedNames = (app as unknown as { plugins: KickPlugin[] }).plugins.map((p) => p.name)
    expect(sortedNames).toEqual(['A', 'B', 'C'])
  })

  it('throws MissingMountDepError when a plugin dependsOn references an unknown plugin', () => {
    expect(
      () =>
        new Application({
          modules: [],
          plugins: [tracePlugin('AuthPlugin', ['NotInstalled'])],
        }),
    ).toThrowError(MissingMountDepError)
  })

  it('throws MountCycleError on plugin dependsOn cycle', () => {
    expect(
      () =>
        new Application({
          modules: [],
          plugins: [tracePlugin('A', ['B']), tracePlugin('B', ['A'])],
        }),
    ).toThrowError(MountCycleError)
  })
})

describe('Application — adapter dependsOn', () => {
  it('mounts adapters in topological order via dependsOn', () => {
    const app = new Application({
      modules: [],
      adapters: [traceAdapter('AuthAdapter', ['TenantAdapter']), traceAdapter('TenantAdapter')],
    })
    const sortedNames = (app as unknown as { adapters: AppAdapter[] }).adapters.map((a) => a.name)
    expect(sortedNames).toEqual(['TenantAdapter', 'AuthAdapter'])
  })

  it('preserves declaration order for adapters without dependsOn', () => {
    const app = new Application({
      modules: [],
      adapters: [traceAdapter('X'), traceAdapter('Y'), traceAdapter('Z')],
    })
    const sortedNames = (app as unknown as { adapters: AppAdapter[] }).adapters.map((a) => a.name)
    expect(sortedNames).toEqual(['X', 'Y', 'Z'])
  })

  it('throws MissingMountDepError when an adapter dependsOn references an unknown adapter', () => {
    expect(
      () =>
        new Application({
          modules: [],
          adapters: [traceAdapter('AuthAdapter', ['NotInstalled'])],
        }),
    ).toThrowError(MissingMountDepError)
  })

  it('throws MountCycleError on adapter dependsOn cycle', () => {
    expect(
      () =>
        new Application({
          modules: [],
          adapters: [traceAdapter('A', ['B']), traceAdapter('B', ['A'])],
        }),
    ).toThrowError(MountCycleError)
  })

  it('synthesizes a name for adapters that omit one (no collision on multiple anonymous)', () => {
    // Two anonymous adapters used to silently collide if both mapped to undefined name.
    // Now they get fallback names from constructor.name (or AnonymousAdapter#i)
    // and pass through mountSort cleanly.
    expect(
      () =>
        new Application({
          modules: [],
          adapters: [
            { middleware: () => [] }, // no name
            { middleware: () => [] }, // no name
          ],
        }),
    ).not.toThrow()
  })
})

describe('Application — plugin + adapter dependsOn interaction', () => {
  it('plugin sort runs before plugin.adapters() is read', () => {
    const events: string[] = []

    const tenantPlugin: KickPlugin = {
      name: 'TenantPlugin',
      adapters() {
        events.push('TenantPlugin.adapters()')
        return []
      },
    }

    const authPlugin: KickPlugin = {
      name: 'AuthPlugin',
      dependsOn: ['TenantPlugin'],
      adapters() {
        events.push('AuthPlugin.adapters()')
        return []
      },
    }

    // Declared in reverse order — plugin sort must run first so TenantPlugin.adapters()
    // fires before AuthPlugin.adapters().
    new Application({
      modules: [],
      plugins: [authPlugin, tenantPlugin],
    })

    expect(events).toEqual(['TenantPlugin.adapters()', 'AuthPlugin.adapters()'])
  })

  it('plugin-shipped adapters are merged with user adapters and sorted together', () => {
    const tenantPlugin: KickPlugin = {
      name: 'TenantPlugin',
      adapters: () => [traceAdapter('TenantAdapter')],
    }

    const app = new Application({
      modules: [],
      plugins: [tenantPlugin],
      adapters: [traceAdapter('AuthAdapter', ['TenantAdapter'])],
    })

    const sortedNames = (app as unknown as { adapters: AppAdapter[] }).adapters.map((a) => a.name)
    expect(sortedNames).toEqual(['TenantAdapter', 'AuthAdapter'])
  })
})
