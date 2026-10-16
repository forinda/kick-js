import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Container } from '../src/container'
import { Autowired, Inject, Service } from '../src/decorators'
import { createToken } from '../src/token'
import { DiError } from '../src/errors'
import { Scope } from '../src/interfaces'

const GREETING = createToken<string>('fallback/greeting')

describe('Container.registerFallback', () => {
  it('serves the fallback when nothing else binds the token', () => {
    const c = Container.create()
    c.registerFallback(GREETING, () => 'default')
    expect(c.resolve(GREETING)).toBe('default')
    expect(c.has(GREETING)).toBe(false)
  })

  it('loses to a normal binding made before it', () => {
    const c = Container.create()
    c.registerFactory(GREETING, () => 'app')
    c.registerFallback(GREETING, () => 'default')
    expect(c.resolve(GREETING)).toBe('app')
  })

  it('loses to a normal binding made after it', () => {
    const c = Container.create()
    c.registerFallback(GREETING, () => 'default')
    c.registerInstance(GREETING, 'app')
    expect(c.resolve(GREETING)).toBe('app')
    expect(c.has(GREETING)).toBe(true)
  })

  it('a second fallback replaces the first', () => {
    const c = Container.create()
    c.registerFallback(GREETING, () => 'first')
    c.registerFallback(GREETING, () => 'second')
    expect(c.resolve(GREETING)).toBe('second')
  })

  it('throws KICK010 when the token is bound after its fallback singleton was resolved', () => {
    const c = Container.create()
    c.registerFallback(GREETING, () => 'default')
    c.resolve(GREETING)
    for (const bind of [
      () => c.registerInstance(GREETING, 'app'),
      () => c.registerFactory(GREETING, () => 'app'),
      () => c.registerFallback(GREETING, () => 'other'),
    ]) {
      expect(bind).toThrow(DiError)
      expect(bind).toThrow(/fallback\/greeting/)
    }
    expect(c.resolve(GREETING)).toBe('default')
  })

  it('allows the binding again once the fallback is invalidated', () => {
    const c = Container.create()
    c.registerFallback(GREETING, () => 'default')
    c.resolve(GREETING)
    c.invalidate(GREETING)
    c.registerInstance(GREETING, 'app')
    expect(c.resolve(GREETING)).toBe('app')
  })

  it('does not throw for a non-singleton fallback that was resolved', () => {
    const c = Container.create()
    c.registerFallback(GREETING, () => 'default', Scope.TRANSIENT)
    c.resolve(GREETING)
    c.registerInstance(GREETING, 'app')
    expect(c.resolve(GREETING)).toBe('app')
  })

  it('honours scope: singleton caches, transient re-runs', () => {
    const c = Container.create()
    const ONE = createToken<object>('fallback/one')
    const MANY = createToken<object>('fallback/many')
    c.registerFallback(ONE, () => ({}))
    c.registerFallback(MANY, () => ({}), Scope.TRANSIENT)
    expect(c.resolve(ONE)).toBe(c.resolve(ONE))
    expect(c.resolve(MANY)).not.toBe(c.resolve(MANY))
  })

  it('is injected into decorated classes', () => {
    @Service()
    class Greeter {
      @Autowired(GREETING) prop!: string
      constructor(@Inject(GREETING) readonly ctor: string) {}
    }
    const c = Container.create()
    c.registerFallback(GREETING, () => 'default')
    const g = c.resolve(Greeter)
    expect([g.ctor, g.prop]).toEqual(['default', 'default'])
  })

  it('lists the active fallback with fallback: true and hides an overridden one', () => {
    const c = Container.create()
    const OTHER = createToken<string>('fallback/other')
    c.registerFallback(GREETING, () => 'default')
    c.registerFallback(OTHER, () => 'default')
    c.registerInstance(OTHER, 'app')
    const regs = c.getRegistrations().filter((r) => r.token.startsWith('fallback/'))
    expect(regs.find((r) => r.token === 'fallback/greeting')).toMatchObject({
      fallback: true,
      kind: 'factory',
    })
    const other = regs.filter((r) => r.token === 'fallback/other')
    expect(other).toHaveLength(1)
    expect(other[0].fallback).toBeUndefined()
  })

  it('emits registered/resolved changes for the fallback', () => {
    const c = Container.create()
    const seen: string[] = []
    c.onChange((changes) => seen.push(...changes.map((e) => `${e.event}:${e.token}`)))
    c.registerFallback(GREETING, () => 'default')
    c.resolve(GREETING)
    c.flushChanges()
    expect(seen).toEqual(['registered:fallback/greeting', 'resolved:fallback/greeting'])
  })

  it('is cleared by Container.reset()', () => {
    Container.getInstance().registerFallback(GREETING, () => 'default')
    Container.reset()
    expect(() => Container.getInstance().resolve(GREETING)).toThrow(/KICK001/)
  })

  it('types the factory from the token', () => {
    const c = Container.create()
    // @ts-expect-error — a number is not a string
    c.registerFallback(GREETING, () => 42)
    expect(c).toBeDefined()
  })
})
