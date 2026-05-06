import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  Container,
  defineModule,
  type AppModule,
  type ContributorRegistrations,
  type ModuleRoutes,
} from '../src/core'

describe('defineModule — factory shape', () => {
  it('returns a callable factory with .scoped and .definition', () => {
    const TasksModule = defineModule({
      name: 'TasksModule',
      build: () => ({
        routes: () => null,
      }),
    })

    expect(typeof TasksModule).toBe('function')
    expect(typeof TasksModule.scoped).toBe('function')
    expect(TasksModule.definition.name).toBe('TasksModule')
    expect(Object.isFrozen(TasksModule.definition)).toBe(true)
  })

  it('produces an AppModule instance on bare call', () => {
    const TasksModule = defineModule({
      name: 'TasksModule',
      build: () => ({
        routes: () => ({ path: '/tasks', router: {} as never }) as ModuleRoutes,
      }),
    })

    const instance = TasksModule()
    expect(typeof instance.routes).toBe('function')
    const routes = instance.routes() as ModuleRoutes
    expect(routes.path).toBe('/tasks')
  })

  it('threads merged config through to build()', () => {
    interface Cfg {
      scope: string
    }
    const Mod = defineModule<Cfg>({
      name: 'ScopedModule',
      defaults: { scope: 'public' },
      build: (config) => ({
        routes: () => ({ path: `/${config.scope}/x`, router: {} as never }) as ModuleRoutes,
      }),
    })

    expect((Mod().routes() as ModuleRoutes).path).toBe('/public/x')
    expect((Mod({ scope: 'admin' }).routes() as ModuleRoutes).path).toBe('/admin/x')
  })

  it('.scoped() namespaces the build context name and preserves config merge', () => {
    interface Cfg {
      scope: string
    }
    let capturedName = ''
    let capturedScoped = false
    const Mod = defineModule<Cfg>({
      name: 'BaseModule',
      defaults: { scope: 'public' },
      build: (_config, ctx) => {
        capturedName = ctx.name
        capturedScoped = ctx.scoped
        return { routes: () => null }
      },
    })

    Mod.scoped('admin', { scope: 'admin' })
    expect(capturedName).toBe('BaseModule:admin')
    expect(capturedScoped).toBe(true)

    Mod()
    expect(capturedName).toBe('BaseModule')
    expect(capturedScoped).toBe(false)
  })

  it('preserves TExtra methods on the returned instance', () => {
    interface Cfg {
      tag: string
    }
    interface Extra {
      describe(): string
    }
    const Mod = defineModule<Cfg, Extra>({
      name: 'ExtraModule',
      defaults: { tag: 'x' },
      build: (config) => ({
        routes: () => null,
        describe: () => `tag=${config.tag}`,
      }),
    })

    const instance = Mod({ tag: 'y' })
    expect(instance.describe()).toBe('tag=y')
  })

  it('passes a Container through to register()', () => {
    let registeredContainer: Container | undefined
    const Mod = defineModule({
      name: 'RegMod',
      build: () => ({
        register(container) {
          registeredContainer = container
        },
        routes: () => null,
      }),
    })

    const instance = Mod()
    const container = Container.create()
    instance.register?.(container)
    expect(registeredContainer).toBe(container)
  })

  it('contributors() pass-through works', () => {
    const fakeRegistrations = [{ key: 'tenant' } as never] as ContributorRegistrations
    const Mod = defineModule({
      name: 'ContribMod',
      build: () => ({
        routes: () => null,
        contributors: () => fakeRegistrations,
      }),
    })

    expect(Mod().contributors?.()).toBe(fakeRegistrations)
  })
})

describe('defineModule — boot-time validation', () => {
  it('throws when options is null / not an object', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => defineModule(null)).toThrow(/options must be an object literal/)
    // @ts-expect-error
    expect(() => defineModule(42)).toThrow(/options must be an object literal/)
  })

  it('throws when options.name is missing or empty', () => {
    expect(() =>
      defineModule({
        // @ts-expect-error — testing runtime guard
        build: () => ({ routes: () => null }) as AppModule,
      }),
    ).toThrow(/options\.name must be a non-empty string/)
    expect(() =>
      defineModule({
        name: '',
        build: () => ({ routes: () => null }) as AppModule,
      }),
    ).toThrow(/options\.name must be a non-empty string/)
  })

  it('throws when options.build is missing or not a function', () => {
    expect(() =>
      defineModule({
        // @ts-expect-error — testing runtime guard
        name: 'NoBuild',
      }),
    ).toThrow(/options\.build is required and must be a function/)
    expect(() =>
      defineModule({
        name: 'NoBuild',
        // @ts-expect-error
        build: 'not-a-function',
      }),
    ).toThrow(/options\.build is required and must be a function/)
  })

  it('error messages name the offending module', () => {
    expect(() =>
      defineModule({
        name: 'BadOne',
        // @ts-expect-error
        build: 42,
      }),
    ).toThrow(/defineModule\(BadOne\)/)
  })
})
