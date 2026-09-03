/**
 * Type-level guards for the `RouteFlag` decorator overloads.
 *
 * The failure these exist to prevent: a flag whose VALUE is an object
 * (`@Limit({ rpm: 10 })`) matching the bare-decorator signature, which returns
 * `void` and fails with `TS1241: Unable to resolve signature of method
 * decorator … Type 'void' has no call signatures`. Runtime was always fine —
 * the factory discriminates on its arguments — so only a type test catches it.
 */
import { describe, it, expectTypeOf } from 'vitest'
import { defineRouteFlag, type RouteFlag } from '../src/index'

const Public = defineRouteFlag('auth.public')
const Limit = defineRouteFlag<{ rpm: number }>('rate.limit')

describe('RouteFlag overloads', () => {
  it('applies bare and with a value, on both methods and classes', () => {
    class MethodTarget {
      @Public
      bare() {}

      @Public(false)
      off() {}

      @Limit({ rpm: 10 })
      valued() {}
    }

    @Public
    class BareClass {}

    @Limit({ rpm: 5 })
    class ValuedClass {}

    @Public(false)
    class OffClass {}

    expectTypeOf<MethodTarget>().toBeObject()
    expectTypeOf<BareClass>().toBeObject()
    expectTypeOf<ValuedClass>().toBeObject()
    expectTypeOf<OffClass>().toBeObject()
  })

  it('carries the flag name and the value type', () => {
    expectTypeOf(Public.flagName).toEqualTypeOf<string>()
    expectTypeOf(Limit).toEqualTypeOf<RouteFlag<{ rpm: number }>>()
    // Calling with a value returns a decorator, not void.
    expectTypeOf(Limit({ rpm: 1 })).toBeFunction()
  })

  it('rejects a value of the wrong shape', () => {
    // @ts-expect-error rpm is a number
    Limit({ rpm: 'ten' })
    // @ts-expect-error a flag value is not a free-form string
    Public('yes')
  })

  it('accepts an explicit `true`, which reads the same as the bare form', () => {
    class T {
      @Public(true)
      on() {}
    }
    expectTypeOf<T>().toBeObject()
  })
})
