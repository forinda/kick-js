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
import { defineRouteFlag, getRouteFlags, type RouteFlag, type RouteFlagTest } from '../src/index'

const Public = defineRouteFlag('auth.public')
const Limit = defineRouteFlag<{ rpm: number }>('rate.limit')

describe('KickRouteFlags narrowing', () => {
  it('infers a flag value from the registry, no explicit generic', () => {
    const Limit = defineRouteFlag('rate.limit')
    expectTypeOf(Limit).toEqualTypeOf<RouteFlag<{ rpm: number }>>()

    const Pub = defineRouteFlag('auth.public')
    expectTypeOf(Pub).toEqualTypeOf<RouteFlag<true>>()
  })

  it('refuses bare application on a flag whose value is not `true`', () => {
    const Limit = defineRouteFlag('rate.limit')

    class T {
      // @ts-expect-error bare `@Limit` would store `true`, but the registry
      // promises readers `{ rpm: number }`
      @Limit
      wrong() {}

      @Limit({ rpm: 10 })
      right() {}
    }
    expectTypeOf<T>().toBeObject()
  })

  it('rejects a name the registry does not declare', () => {
    // @ts-expect-error 'auth.pubic' is a typo — the whole point of the registry
    defineRouteFlag('auth.pubic')
  })

  it('types flags.get by name', () => {
    const flags = getRouteFlags(class {}, 'x')
    expectTypeOf(flags.get('rate.limit')).toEqualTypeOf<{ rpm: number } | undefined>()
    expectTypeOf(flags.get('auth.public')).toEqualTypeOf<true | undefined>()
  })

  it('rejects a misspelt name in has() and in a flag test', () => {
    const flags = getRouteFlags(class {}, 'x')
    // @ts-expect-error not a declared flag
    flags.has('nope')

    // @ts-expect-error not a declared flag
    const bad: RouteFlagTest = 'auth.pubic'
    void bad
  })

  it('accepts a declared name, a list of them, and a predicate', () => {
    expectTypeOf<'auth.public'>().toMatchTypeOf<RouteFlagTest>()
    expectTypeOf<['auth.public', 'rate.limit']>().toMatchTypeOf<RouteFlagTest>()
    const predicate: RouteFlagTest = ({ flags }) => flags.has('auth.public')
    void predicate
  })
})

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

describe('negated flag tests', () => {
  it('accepts a negated name and a single-polarity list', () => {
    expectTypeOf<'!auth.public'>().toMatchTypeOf<RouteFlagTest>()
    expectTypeOf<['!auth.public', '!rate.limit']>().toMatchTypeOf<RouteFlagTest>()
  })

  it('rejects a misspelt negation', () => {
    // @ts-expect-error 'auth.pubic' is not a declared flag, negated or not
    const bad: RouteFlagTest = '!auth.pubic'
    void bad
  })

  it('rejects a list that mixes polarities', () => {
    // @ts-expect-error mixed polarity has no reading everyone agrees on —
    // use a predicate
    const mixed: RouteFlagTest = ['auth.public', '!rate.limit']
    void mixed
  })
})
