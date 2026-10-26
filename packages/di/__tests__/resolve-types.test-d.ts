/**
 * `container.resolve()` infers what it returns from the token, for every kind
 * of class, and refuses what isn't a token instead of returning `any`.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { Container, createToken } from '../src'

class Plain {
  a = 1
}
abstract class AbstractRepo {
  abstract find(): string
}
class PrivateCtor {
  private constructor() {}
  p = 1
}
class ProtectedCtor {
  protected constructor() {}
  q = 1
}
interface Bus {
  emit(): void
}
interface WiderBus extends Bus {
  close(): void
}
const BUS = createToken<Bus>('Bus')

const c = Container.getInstance()

describe('container.resolve() types', () => {
  it('infers classes, abstract or with a non-public constructor', () => {
    expectTypeOf(c.resolve(Plain)).toEqualTypeOf<Plain>()
    expectTypeOf(c.resolve(AbstractRepo)).toEqualTypeOf<AbstractRepo>()
    expectTypeOf(c.resolve(PrivateCtor)).toEqualTypeOf<PrivateCtor>()
    expectTypeOf(c.resolve(ProtectedCtor)).toEqualTypeOf<ProtectedCtor>()
  })

  it('infers a class from an awaited inline import', async () => {
    const mod = { Plain, AbstractRepo }
    const loaded = await Promise.resolve(mod)
    expectTypeOf(c.resolve(loaded.AbstractRepo)).toEqualTypeOf<AbstractRepo>()
  })

  it('infers injection tokens, and lets an explicit T widen one', () => {
    expectTypeOf(c.resolve(BUS)).toEqualTypeOf<Bus>()
    expectTypeOf(c.resolve<WiderBus>(BUS)).toEqualTypeOf<WiderBus>()
  })

  it('returns any for unregistered strings and symbols, and for an any token', () => {
    const anyToken: any = 'Whatever'
    expectTypeOf(c.resolve('NotRegistered')).toBeAny()
    expectTypeOf(c.resolve(Symbol('s'))).toBeAny()
    expectTypeOf(c.resolve(anyToken)).toBeAny()
    expectTypeOf(c.resolve<Plain>('Plain')).toEqualTypeOf<Plain>()
  })

  it('refuses what is not a token', () => {
    // @ts-expect-error a Promise from an un-awaited import() is not a token
    c.resolve(Promise.resolve(Plain))
    // @ts-expect-error nor is a plain object
    c.resolve({ a: 1 })
  })
})
