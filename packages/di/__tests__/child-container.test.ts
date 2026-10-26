import 'reflect-metadata'
import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { Container, type RequestStore } from '../src/container'
import { Inject } from '../src/decorators'
import { createToken } from '../src/token'
import { Scope } from '../src/interfaces'

interface Mailer {
  name: string
}
const MAILER = createToken<Mailer>('test/child/mailer')
const CONFIG = createToken<{ version: number }>('test/child/config')
const DB = createToken<{ tenant: string }>('test/child/db')

class OrderService {
  constructor(@Inject(MAILER) readonly mailer: Mailer) {}
}

class ReportService {
  constructor(@Inject(DB) readonly db: { tenant: string }) {}
  title() {
    return `report for ${this.db.tenant}`
  }
}

class Versioned {
  constructor(@Inject(CONFIG) readonly config: { version: number }) {}
}

describe('Container.createChild', () => {
  it('resolves its own bindings first, and falls back to the parent', () => {
    const root = Container.create()
    root.registerInstance(MAILER, { name: 'root' })
    root.registerInstance(CONFIG, { version: 1 })
    const child = root.createChild()
    child.registerInstance(MAILER, { name: 'child' })

    expect(child.resolve(MAILER).name).toBe('child')
    expect(root.resolve(MAILER).name).toBe('root')
    expect(child.resolve(CONFIG).version).toBe(1)
    expect(() => child.resolve(DB)).toThrow()
  })

  it('has() looks through to the parent; hasOwn() does not', () => {
    const root = Container.create()
    root.registerInstance(CONFIG, { version: 1 })
    const child = root.createChild()
    child.registerInstance(MAILER, { name: 'child' })

    expect(child.has(CONFIG)).toBe(true)
    expect(child.hasOwn(CONFIG)).toBe(false)
    expect(child.hasOwn(MAILER)).toBe(true)
    expect(root.has(MAILER)).toBe(false)
  })

  it("prefers the parent's binding over its own fallback", () => {
    const root = Container.create()
    root.registerInstance(MAILER, { name: 'root' })
    const child = root.createChild()
    child.registerFallback(MAILER, () => ({ name: 'child fallback' }))
    expect(child.resolve(MAILER).name).toBe('root')

    const bare = Container.create().createChild()
    bare.registerFallback(MAILER, () => ({ name: 'child fallback' }))
    expect(bare.resolve(MAILER).name).toBe('child fallback')
  })

  it("keeps the parent's binding ahead of its own fallback after HMR re-creates the class", () => {
    const make = () =>
      class Reloaded {
        readonly from: string = 'parent'
      }
    const Before = make()
    const root = Container.create()
    root.register(Before, Before)
    // Vite re-evaluated the module: same name, new identity.
    const After = make()
    const child = root.createChild()
    child.registerFallback(After, () => ({ from: 'child fallback' }))
    expect(child.resolve(After).from).toBe('parent')
  })

  it("an override reaches what the child builds; the parent's instances keep the parent's", () => {
    const root = Container.create()
    root.registerInstance(MAILER, { name: 'root' })
    root.register(OrderService, OrderService)
    const child = root.createChild()
    child.registerInstance(MAILER, { name: 'child' })

    // Registered only in the parent: built there, with the parent's mailer.
    expect(child.resolve(OrderService).mailer.name).toBe('root')
    expect(child.resolve(OrderService)).toBe(root.resolve(OrderService))

    // Registered in the child too: the child builds its own, with its override.
    child.register(OrderService, OrderService)
    expect(child.resolve(OrderService).mailer.name).toBe('child')
    expect(child.resolve(OrderService)).not.toBe(root.resolve(OrderService))
  })

  describe('REQUEST scope', () => {
    const scope = new AsyncLocalStorage<RequestStore>()
    const previous = Container.requestStoreProvider
    afterEach(() => Container.setRequestStoreProvider(previous))

    it("keeps a child's request instances apart from the parent's in the same request", () => {
      Container.setRequestStoreProvider(() => scope.getStore() ?? null)
      class RequestThing {}
      const root = Container.create()
      root.register(RequestThing, RequestThing, Scope.REQUEST)
      const child = root.createChild()
      child.register(RequestThing, RequestThing, Scope.REQUEST)

      const store: RequestStore = { instances: new Map(), values: new Map() }
      scope.run(store, () => {
        const fromRoot = root.resolve(RequestThing)
        const fromChild = child.resolve(RequestThing)
        expect(fromChild).not.toBe(fromRoot)
        expect(root.resolve(RequestThing)).toBe(fromRoot)
        expect(child.resolve(RequestThing)).toBe(fromChild)
        // Both are plain entries, so request teardown (@PreDestroy) reaches both.
        expect([...store.instances.values()]).toEqual(expect.arrayContaining([fromRoot, fromChild]))
      })
    })
  })

  it('rebuilds what the child built on a binding the parent invalidates', () => {
    let version = 0
    const root = Container.create()
    root.registerFactory(CONFIG, () => ({ version: ++version }))
    const child = root.createChild()
    child.register(Versioned, Versioned)

    const before = child.resolve(Versioned)
    expect(before.config.version).toBe(1)
    root.invalidate(CONFIG)
    const after = child.resolve(Versioned)
    expect(after).not.toBe(before)
    expect(after.config.version).toBe(2)

    const grandchild = child.createChild()
    grandchild.register(Versioned, Versioned)
    const deep = grandchild.resolve(Versioned)
    root.invalidate(CONFIG)
    expect(grandchild.resolve(Versioned)).not.toBe(deep)
  })

  it('dispose() detaches the child and drops what it built', () => {
    const root = Container.create()
    root.registerFactory(CONFIG, () => ({ version: 1 }))
    const child = root.createChild()
    child.registerInstance(MAILER, { name: 'child' })
    child.dispose()

    expect(child.hasOwn(MAILER)).toBe(false)
    expect(() => child.resolve(CONFIG)).toThrow()
    expect(() => root.invalidate(CONFIG)).not.toThrow()
  })

  it('serves one tenant per child', () => {
    const root = Container.create()
    root.registerInstance(MAILER, { name: 'shared' })
    const forTenant = (tenant: string) => {
      const child = root.createChild()
      child.registerInstance(DB, { tenant })
      child.register(ReportService, ReportService)
      return child
    }
    const acme = forTenant('acme')
    const globex = forTenant('globex')

    expect(acme.resolve(ReportService).title()).toBe('report for acme')
    expect(globex.resolve(ReportService).title()).toBe('report for globex')
    expect(acme.resolve(MAILER)).toBe(globex.resolve(MAILER))
  })
})
