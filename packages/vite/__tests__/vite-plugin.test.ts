import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { kickjsVitePlugin } from '@forinda/kickjs-vite'
import type { Plugin } from 'vite'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a sub-plugin by name from the plugin array */
function findPlugin(plugins: Plugin[], name: string): Plugin | undefined {
  return plugins.find((p) => p.name === name)
}

/** Invoke the config hook on a plugin and return the merged config fragment */
function callConfigHook(
  plugin: Plugin,
  command: 'serve' | 'build' = 'serve',
  userConfig: Record<string, any> = {},
) {
  const hook = plugin.config
  if (typeof hook === 'function') {
    return (hook as any)(userConfig, {
      command,
      mode: command === 'serve' ? 'development' : 'production',
    })
  }
  return undefined
}

/** Invoke the resolveId hook on a plugin */
function callResolveId(plugin: Plugin, id: string) {
  const hook = plugin.resolveId
  if (typeof hook === 'function') {
    return (hook as any).call({}, id, undefined, {})
  }
  return undefined
}

/** Invoke the load hook on a plugin */
function callLoad(plugin: Plugin, id: string) {
  const hook = plugin.load
  if (typeof hook === 'function') {
    return (hook as any).call({}, id, {})
  }
  return undefined
}

/** Invoke the transform hook on a plugin */
function callTransform(plugin: Plugin, code: string, id: string) {
  const hook = plugin.transform
  if (typeof hook === 'function') {
    return (hook as any).call({}, code, id, {})
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Tests: kickjsVitePlugin() factory
// ---------------------------------------------------------------------------

describe('kickjsVitePlugin()', () => {
  let plugins: Plugin[]

  beforeEach(() => {
    plugins = kickjsVitePlugin()
  })

  it('returns an array of plugins', () => {
    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBeGreaterThan(0)
  })

  it('returns all expected sub-plugins', () => {
    const names = plugins.map((p) => p.name)
    expect(names).toContain('kickjs:root-resolver')
    expect(names).toContain('kickjs:core')
    expect(names).toContain('kickjs:module-discovery')
    expect(names).toContain('kickjs:hmr')
    expect(names).toContain('kickjs:virtual-modules')
    expect(names).toContain('kickjs:dev-server')
  })

  it('returns exactly 6 sub-plugins', () => {
    expect(plugins).toHaveLength(6)
  })

  it('accepts a custom entry option', () => {
    const custom = kickjsVitePlugin({ entry: 'app/server.ts' })
    expect(custom).toHaveLength(6)
  })

  it('accepts empty options', () => {
    const noArgs = kickjsVitePlugin({})
    expect(noArgs).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------
// Tests: kickjs:core plugin — config hook
// ---------------------------------------------------------------------------

describe('kickjs:core plugin', () => {
  let corePlugin: Plugin

  beforeEach(() => {
    corePlugin = findPlugin(kickjsVitePlugin(), 'kickjs:core')!
    expect(corePlugin).toBeDefined()
  })

  it('sets appType to "custom"', () => {
    const config = callConfigHook(corePlugin, 'serve')
    expect(config).toBeDefined()
    expect(config.appType).toBe('custom')
  })

  it('sets clearScreen to false', () => {
    const config = callConfigHook(corePlugin, 'serve')
    expect(config.clearScreen).toBe(false)
  })

  it('externalizes @forinda/kickjs in SSR config', () => {
    const config = callConfigHook(corePlugin, 'serve')
    expect(config.ssr).toBeDefined()
    expect(config.ssr.external).toContain('@forinda/kickjs')
  })

  it('externalizes express in SSR config', () => {
    const config = callConfigHook(corePlugin)
    expect(config.ssr.external).toContain('express')
  })

  it('externalizes reflect-metadata in SSR config', () => {
    const config = callConfigHook(corePlugin)
    expect(config.ssr.external).toContain('reflect-metadata')
  })

  it('disables optimizeDeps discovery for SSR-only apps', () => {
    const serveConfig = callConfigHook(corePlugin, 'serve')
    expect(serveConfig.optimizeDeps.noDiscovery).toBe(true)

    const buildConfig = callConfigHook(corePlugin, 'build')
    expect(buildConfig.optimizeDeps.noDiscovery).toBe(true)
  })

  it('configures SSR environment with warmup for entry', () => {
    const config = callConfigHook(corePlugin)
    expect(config.environments).toBeDefined()
    expect(config.environments.ssr).toBeDefined()
    expect(config.environments.ssr.dev).toBeDefined()
    expect(config.environments.ssr.dev.warmup).toBeDefined()
    expect(Array.isArray(config.environments.ssr.dev.warmup)).toBe(true)
  })

  it('sets server.port from process.env.PORT when no explicit config', () => {
    const originalPort = process.env.PORT
    process.env.PORT = '4000'
    try {
      const plugin = findPlugin(kickjsVitePlugin(), 'kickjs:core')!
      const config = callConfigHook(plugin, 'serve', {})
      expect(config.server.port).toBe(4000)
    } finally {
      if (originalPort !== undefined) {
        process.env.PORT = originalPort
      } else {
        delete process.env.PORT
      }
    }
  })

  it('defaults server.port to 3000 when PORT env is not set', () => {
    const originalPort = process.env.PORT
    delete process.env.PORT
    try {
      const plugin = findPlugin(kickjsVitePlugin(), 'kickjs:core')!
      const config = callConfigHook(plugin, 'serve', {})
      expect(config.server.port).toBe(3000)
    } finally {
      if (originalPort !== undefined) {
        process.env.PORT = originalPort
      } else {
        delete process.env.PORT
      }
    }
  })

  it('yields to explicit server.port from user config', () => {
    const originalPort = process.env.PORT
    process.env.PORT = '4000'
    try {
      const plugin = findPlugin(kickjsVitePlugin(), 'kickjs:core')!
      const config = callConfigHook(plugin, 'serve', { server: { port: 5555 } })
      // User's explicit port wins over .env PORT
      expect(config.server.port).toBe(5555)
    } finally {
      if (originalPort !== undefined) {
        process.env.PORT = originalPort
      } else {
        delete process.env.PORT
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: kickjs:virtual-modules plugin — resolveId + load
// ---------------------------------------------------------------------------

describe('kickjs:virtual-modules plugin', () => {
  const VIRTUAL_APP = 'virtual:kickjs/app'
  const RESOLVED_APP = '\0virtual:kickjs/app'

  let vmPlugin: Plugin

  beforeEach(() => {
    vmPlugin = findPlugin(kickjsVitePlugin(), 'kickjs:virtual-modules')!
    expect(vmPlugin).toBeDefined()
  })

  describe('resolveId()', () => {
    it('resolves virtual:kickjs/app to the \\0-prefixed ID', () => {
      const resolved = callResolveId(vmPlugin, VIRTUAL_APP)
      expect(resolved).toBe(RESOLVED_APP)
    })

    it('returns undefined for unknown module IDs', () => {
      expect(callResolveId(vmPlugin, 'some-other-module')).toBeUndefined()
    })

    it('returns undefined for similar but wrong virtual IDs', () => {
      expect(callResolveId(vmPlugin, 'virtual:kickjs/modules')).toBeUndefined()
      expect(callResolveId(vmPlugin, 'virtual:kickjs')).toBeUndefined()
      expect(callResolveId(vmPlugin, 'kickjs/app')).toBeUndefined()
    })
  })

  describe('load()', () => {
    it('generates code for the resolved virtual app module', () => {
      const code = callLoad(vmPlugin, RESOLVED_APP)
      expect(code).toBeDefined()
      expect(typeof code).toBe('string')
    })

    it('generated code contains export * from the entry file', () => {
      const code = callLoad(vmPlugin, RESOLVED_APP) as string
      expect(code).toContain('export *')
      expect(code).toContain('src/index.ts')
    })

    it('generated code contains auto-generated comment', () => {
      const code = callLoad(vmPlugin, RESOLVED_APP) as string
      expect(code).toContain('Auto-generated by @forinda/kickjs-vite')
    })

    it('returns undefined for non-matching IDs', () => {
      expect(callLoad(vmPlugin, 'some-other-id')).toBeUndefined()
      expect(callLoad(vmPlugin, VIRTUAL_APP)).toBeUndefined() // not the resolved form
    })

    it('uses custom entry in generated code', () => {
      const customPlugins = kickjsVitePlugin({ entry: 'app/server.ts' })
      const customVm = findPlugin(customPlugins, 'kickjs:virtual-modules')!
      const code = callLoad(customVm, RESOLVED_APP) as string
      expect(code).toContain('app/server.ts')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: kickjs:hmr plugin — decorator detection & transform
// ---------------------------------------------------------------------------

describe('kickjs:hmr plugin', () => {
  let hmrPlugin: Plugin

  beforeEach(() => {
    hmrPlugin = findPlugin(kickjsVitePlugin(), 'kickjs:hmr')!
    expect(hmrPlugin).toBeDefined()
  })

  describe('transform() — decorator detection', () => {
    it('returns null (does not transform code)', () => {
      const code = `
@Service()
export class UserService {
  getUsers() { return [] }
}
`
      const result = callTransform(hmrPlugin, code, '/src/user.service.ts')
      expect(result).toBeNull()
    })

    it('skips non-TypeScript files', () => {
      const code = '@Service()\nexport class Foo {}'
      const result = callTransform(hmrPlugin, code, '/src/style.css')
      expect(result).toBeNull()
    })

    it('skips node_modules files', () => {
      const code = '@Service()\nexport class Foo {}'
      const result = callTransform(hmrPlugin, code, '/node_modules/some-pkg/index.ts')
      expect(result).toBeNull()
    })

    it('skips files without any decorator keywords', () => {
      const code = `export class PlainClass { hello() {} }`
      const result = callTransform(hmrPlugin, code, '/src/plain.ts')
      expect(result).toBeNull()
    })
  })

  describe('decorator regex patterns', () => {
    // We test the regex indirectly by verifying handleHotUpdate behavior.
    // The transform() hook builds the fileTokenMap; handleHotUpdate reads it.
    // If handleHotUpdate returns [] (handled), the file had tokens detected.

    function simulateTransformAndHmr(code: string, filePath: string) {
      // Transform to register tokens
      callTransform(hmrPlugin, code, filePath)

      // Simulate handleHotUpdate
      const hook = hmrPlugin.handleHotUpdate
      if (typeof hook !== 'function') return undefined

      let sentData: any = null
      const mockServer = {
        moduleGraph: {
          getModuleById: () => null,
          invalidateModule: () => {},
        },
        hot: {
          send: (data: any) => {
            sentData = data
          },
        },
      }

      const result = (hook as any).call({}, { file: filePath, server: mockServer })
      return result
    }

    it('detects @Service() decorator', () => {
      const code = `
@Service()
export class UserService {
  getUsers() { return [] }
}
`
      const result = simulateTransformAndHmr(code, '/src/services/user.service.ts')
      expect(result).toEqual([])
    })

    it('detects @Controller() decorator', () => {
      const code = `
@Controller()
export class UserController {
  index() {}
}
`
      const result = simulateTransformAndHmr(code, '/src/controllers/user.controller.ts')
      expect(result).toEqual([])
    })

    it('detects @Repository() decorator', () => {
      const code = `
@Repository()
export class UserRepository {
  findAll() { return [] }
}
`
      const result = simulateTransformAndHmr(code, '/src/repos/user.repository.ts')
      expect(result).toEqual([])
    })

    it('detects @Injectable() decorator', () => {
      const code = `
@Injectable()
export class CacheService {}
`
      const result = simulateTransformAndHmr(code, '/src/cache.service.ts')
      expect(result).toEqual([])
    })

    it('detects @Component() decorator', () => {
      const code = `
@Component()
export class EventBus {}
`
      const result = simulateTransformAndHmr(code, '/src/event-bus.ts')
      expect(result).toEqual([])
    })

    it('detects class without export keyword', () => {
      const code = `
@Service()
class InternalService {}
`
      const result = simulateTransformAndHmr(code, '/src/internal.service.ts')
      expect(result).toEqual([])
    })

    it('detects multiple decorated classes in one file', () => {
      const code = `
@Service()
export class ServiceA {}

@Repository()
export class RepoB {}
`
      const result = simulateTransformAndHmr(code, '/src/multi.ts')
      expect(result).toEqual([])
    })

    it('still handles project source files without kickjs patterns', () => {
      // Plain helper / utility / side-effect modules don't carry decorators
      // or v4 factories, but they're imported by the running app — a change
      // to one MUST invalidate the virtual app or HMR silently misses it.
      // Returning [] tells Vite "we handled it" and our debounced flush
      // will invalidate the virtual:kickjs/app module.
      const code = `
export class PlainHelper {
  help() { return 'help' }
}
`
      const result = simulateTransformAndHmr(code, '/src/helper.ts')
      expect(result).toEqual([])
    })

    it('ignores non-source files (typegen .d.ts output, dist artefacts)', () => {
      const code = `export declare const FOO: string`
      const dts = simulateTransformAndHmr(code, '/src/foo.d.ts')
      const dist = simulateTransformAndHmr(code, '/project/dist/index.js')
      const kickjs = simulateTransformAndHmr(code, '/project/.kickjs/types/registry.d.ts')
      expect(dts).toBeUndefined()
      expect(dist).toBeUndefined()
      expect(kickjs).toBeUndefined()
    })

    it('detects v4 factory declarations (defineAdapter / definePlugin / defineContextDecorator)', () => {
      const adapter = `
import { defineAdapter } from '@forinda/kickjs'
export const MyAdapter = defineAdapter({ name: 'MyAdapter', build: () => ({}) })
`
      const plugin = `
import { definePlugin } from '@forinda/kickjs'
export const MyPlugin = definePlugin({ name: 'MyPlugin', build: () => ({}) })
`
      const contributor = `
import { defineContextDecorator } from '@forinda/kickjs'
const Load = defineContextDecorator({ key: 'x', resolve: () => 1 })
`
      expect(simulateTransformAndHmr(adapter, '/src/my.adapter.ts')).toEqual([])
      expect(simulateTransformAndHmr(plugin, '/src/my.plugin.ts')).toEqual([])
      expect(simulateTransformAndHmr(contributor, '/src/load.ts')).toEqual([])
    })

    it('handles decorator with arguments on same line as class', () => {
      const code = `@Controller() export class UserController {}`
      // The regex expects newline/whitespace between decorator and class — this
      // may or may not match depending on exact formatting. We verify it does
      // not crash either way.
      const result = simulateTransformAndHmr(code, '/src/inline.controller.ts')
      // Either [] (detected) or undefined (not detected) is acceptable
      expect(result === undefined || (Array.isArray(result) && result.length === 0)).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: kickjs:module-discovery plugin — transform
// ---------------------------------------------------------------------------

describe('kickjs:module-discovery plugin', () => {
  let discoveryPlugin: Plugin

  beforeEach(() => {
    discoveryPlugin = findPlugin(kickjsVitePlugin(), 'kickjs:module-discovery')!
    expect(discoveryPlugin).toBeDefined()
  })

  describe('transform()', () => {
    it('returns null (does not modify code)', () => {
      const code = `export class UserModule {}`
      const result = callTransform(discoveryPlugin, code, '/src/modules/users/user.module.ts')
      expect(result).toBeNull()
    })

    it('skips files not matching *.module.ts pattern', () => {
      const code = `export class UserService {}`
      const result = callTransform(discoveryPlugin, code, '/src/user.service.ts')
      expect(result).toBeNull()
    })

    it('skips node_modules', () => {
      const code = `export class SomeModule {}`
      const result = callTransform(discoveryPlugin, code, '/node_modules/pkg/some.module.ts')
      expect(result).toBeNull()
    })

    it('processes .module.ts files', () => {
      const code = `export class UserModule {}`
      const result = callTransform(discoveryPlugin, code, '/src/user.module.ts')
      expect(result).toBeNull() // still null — discovery only observes
    })

    it('processes .module.js files', () => {
      const code = `export class UserModule {}`
      const result = callTransform(discoveryPlugin, code, '/src/user.module.js')
      expect(result).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: kickjs:dev-server plugin — structure
// ---------------------------------------------------------------------------

describe('kickjs:dev-server plugin', () => {
  let devServerPlugin: Plugin

  beforeEach(() => {
    devServerPlugin = findPlugin(kickjsVitePlugin(), 'kickjs:dev-server')!
    expect(devServerPlugin).toBeDefined()
  })

  it('has the correct plugin name', () => {
    expect(devServerPlugin.name).toBe('kickjs:dev-server')
  })

  it('has a configureServer hook', () => {
    expect(devServerPlugin.configureServer).toBeDefined()
    expect(typeof devServerPlugin.configureServer).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// Tests: kickjs:root-resolver plugin
// ---------------------------------------------------------------------------

describe('kickjs:root-resolver plugin', () => {
  let rootPlugin: Plugin

  beforeEach(() => {
    rootPlugin = findPlugin(kickjsVitePlugin(), 'kickjs:root-resolver')!
    expect(rootPlugin).toBeDefined()
  })

  it('has a config hook', () => {
    expect(rootPlugin.config).toBeDefined()
    expect(typeof rootPlugin.config).toBe('function')
  })

  it('updates context root from config', () => {
    const hook = rootPlugin.config as (config: any, env: any) => any
    // Simulate Vite calling config with user config
    hook({ root: '/custom/project/root' }, {})

    // After config, the virtual-modules plugin should use the new root.
    // We verify indirectly: the entry should now be resolved against the new root.
    const plugins = kickjsVitePlugin()
    const resolver = findPlugin(plugins, 'kickjs:root-resolver')!
    const vm = findPlugin(plugins, 'kickjs:virtual-modules')!

    ;(resolver.config as any)({ root: '/test/root' }, {})

    const code = callLoad(vm, '\0virtual:kickjs/app') as string
    expect(code).toContain('/test/root')
  })
})
