import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Container,
  Scope,
  createToken,
  isInjectionToken,
  tokenName,
  type InjectionToken,
} from '../src/index'

describe('createToken — collision-safe DI tokens', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('returns a frozen object stamped with the InjectionToken marker', () => {
    const token = createToken<string>('config.url')
    expect(isInjectionToken(token)).toBe(true)
    expect(token.name).toBe('config.url')
    expect(Object.isFrozen(token)).toBe(true)
  })

  it('two createToken calls with the same name produce distinct tokens', () => {
    const a = createToken<string>('Logger')
    const b = createToken<string>('Logger')
    expect(a).not.toBe(b)
    expect(isInjectionToken(a)).toBe(true)
    expect(isInjectionToken(b)).toBe(true)
  })

  it('container.registerInstance + resolve round-trips an InjectionToken', () => {
    interface Cfg {
      url: string
    }
    const TOKEN: InjectionToken<Cfg> = createToken<Cfg>('config')
    const container = Container.getInstance()
    container.registerInstance(TOKEN, { url: 'postgres://localhost' })

    const resolved = container.resolve(TOKEN)
    expect(resolved.url).toBe('postgres://localhost')
  })

  it('container.registerFactory + resolve uses the factory', () => {
    const TOKEN = createToken<{ value: number }>('counter')
    let calls = 0
    const container = Container.getInstance()
    container.registerFactory(TOKEN, () => ({ value: ++calls }), Scope.SINGLETON)

    const a = container.resolve(TOKEN)
    const b = container.resolve(TOKEN)
    expect(a.value).toBe(1)
    expect(b.value).toBe(1) // singleton — factory only called once
  })

  it('two same-named tokens stored on the same container are independent', () => {
    const A = createToken<string>('Greeting')
    const B = createToken<string>('Greeting')
    const container = Container.getInstance()
    container.registerInstance(A, 'hello')
    container.registerInstance(B, 'world')
    expect(container.resolve(A)).toBe('hello')
    expect(container.resolve(B)).toBe('world')
  })

  it('tokenName() formats InjectionToken using the provided name', () => {
    const TOKEN = createToken<unknown>('app/users/UserService')
    expect(tokenName(TOKEN)).toBe('app/users/UserService')
  })

  it('isInjectionToken returns false for non-token values', () => {
    expect(isInjectionToken(undefined)).toBe(false)
    expect(isInjectionToken(null)).toBe(false)
    expect(isInjectionToken('Logger')).toBe(false)
    expect(isInjectionToken(42)).toBe(false)
    expect(isInjectionToken({})).toBe(false)
    expect(isInjectionToken({ name: 'fake' })).toBe(false)
    class Foo {}
    expect(isInjectionToken(Foo)).toBe(false)
  })

  it('resolving an unregistered token throws with the descriptive name', () => {
    const TOKEN = createToken<string>('missing.config')
    const container = Container.getInstance()
    expect(() => container.resolve(TOKEN)).toThrow(/missing\.config/)
  })
})
