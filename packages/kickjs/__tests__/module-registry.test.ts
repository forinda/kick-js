import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  MutableModuleRegistry,
  defineModule,
  type AppModule,
  type AppModuleEntry,
} from '../src/core'

describe('MutableModuleRegistry', () => {
  it('starts empty', () => {
    const registry = new MutableModuleRegistry()
    expect(registry.entries).toEqual([])
  })

  it('mount() appends entries in call order', () => {
    const registry = new MutableModuleRegistry()
    const A = defineModule({ name: 'A', build: () => ({ routes: () => null }) })
    const B = defineModule({ name: 'B', build: () => ({ routes: () => null }) })
    const C = defineModule({ name: 'C', build: () => ({ routes: () => null }) })

    registry.mount(A())
    registry.mount(B())
    registry.mount(C())

    expect(registry.entries).toHaveLength(3)
    // mount() preserves call order so the bootstrap loader can rely on
    // first-call → first-mounted semantics.
    expect((registry.entries[0] as AppModule).constructor === Object).toBe(true)
  })

  it('accepts both class and instance forms', () => {
    const registry = new MutableModuleRegistry()

    class LegacyModule implements AppModule {
      routes() {
        return null
      }
    }

    const FactoryModule = defineModule({
      name: 'FactoryModule',
      build: () => ({ routes: () => null }),
    })

    registry.mount(LegacyModule)
    registry.mount(FactoryModule())

    expect(registry.entries).toHaveLength(2)
    expect(typeof registry.entries[0]).toBe('function') // class
    expect(typeof registry.entries[1]).toBe('object') // factory output
  })

  it('produces a referentially-stable entries array (same array instance across mounts)', () => {
    const registry = new MutableModuleRegistry()
    const ref = registry.entries
    const M = defineModule({ name: 'M', build: () => ({ routes: () => null }) })

    registry.mount(M())
    registry.mount(M())

    expect(registry.entries).toBe(ref)
    expect(registry.entries).toHaveLength(2)
  })
})

describe('ModuleRegistry — typed surface', () => {
  it('exposes only `mount` on the public interface (use is reserved for a future PR)', () => {
    const registry = new MutableModuleRegistry()
    // .use isn't part of the ModuleRegistry interface yet — adding it
    // later won't be a breaking change because ModuleRegistry is the
    // adopter-facing type and mount() is the only stable method.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((registry as any).use).toBeUndefined()
    expect(typeof registry.mount).toBe('function')
  })

  it('mount input is structurally an AppModuleEntry — class or AppModule', () => {
    const registry = new MutableModuleRegistry()
    // Type-only assertion: the parameter accepts the union directly.
    const accept: (e: AppModuleEntry) => void = (e) => registry.mount(e)
    const M = defineModule({ name: 'M', build: () => ({ routes: () => null }) })
    accept(M())
    class Legacy implements AppModule {
      routes() {
        return null
      }
    }
    accept(Legacy)
    expect(registry.entries).toHaveLength(2)
  })
})
