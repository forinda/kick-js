import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import {
  defineContextDecorator,
  METADATA,
  type ContributorRegistration,
  type ExecutionContext,
} from '../src/core'

/**
 * Method-level contributor metadata is stored on the constructor (matches the
 * @Middleware convention consumed by router-builder.ts). Tests querying via
 * the prototype would read nothing.
 */
function getMethodContributors(constructor: object, method: string): ContributorRegistration[] {
  return Reflect.getMetadata(METADATA.METHOD_CONTRIBUTORS, constructor, method) ?? []
}

function getClassContributors(target: object): ContributorRegistration[] {
  return Reflect.getMetadata(METADATA.CLASS_CONTRIBUTORS, target) ?? []
}

describe('defineContextDecorator — factory shape', () => {
  it('returns a function with a frozen .registration property', () => {
    const decorator = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })

    expect(typeof decorator).toBe('function')
    expect(decorator.registration).toBeDefined()
    expect(decorator.registration.key).toBe('tenant')

    expect(Object.isFrozen(decorator.registration)).toBe(true)
  })

  it('fills in defaults: dependsOn=[], optional=false, deps={}', () => {
    const decorator = defineContextDecorator({
      key: 'user',
      resolve: () => ({ id: 'u-1' }),
    })

    expect(decorator.registration.dependsOn).toEqual([])
    expect(decorator.registration.optional).toBe(false)
    expect(decorator.registration.deps).toEqual({})
  })

  it('preserves explicitly provided spec fields', () => {
    const onError = () => undefined
    const resolve = () => ({ id: 'p-1' })

    const decorator = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant', 'user'],
      optional: true,
      onError,
      resolve,
    })

    expect(decorator.registration.dependsOn).toEqual(['tenant', 'user'])
    expect(decorator.registration.optional).toBe(true)
    expect(decorator.registration.onError).toBe(onError)
    expect(decorator.registration.resolve).toBe(resolve)
  })

  it('freezes the dependsOn array independently of the spec input', () => {
    const dependsOn = ['tenant']
    const decorator = defineContextDecorator({
      key: 'project',
      dependsOn,
      resolve: () => ({ id: 'p-1' }),
    })

    // Mutating the original array does not leak into the registration —
    // the runner relies on this to skip defensive copies during topo-sort.
    dependsOn.push('mutated')
    expect(decorator.registration.dependsOn).toEqual(['tenant'])
    expect(Object.isFrozen(decorator.registration.dependsOn)).toBe(true)
  })

  it('exposes .registration as non-writable', () => {
    const decorator = defineContextDecorator({
      key: 'user',
      resolve: () => ({ id: 'u-1' }),
    })

    expect(() => {
      // @ts-expect-error — testing runtime non-writability
      decorator.registration = { key: 'hijacked' } as never
    }).toThrow(TypeError)
  })
})

describe('defineContextDecorator — method decorator', () => {
  it('writes the registration to METHOD_CONTRIBUTORS metadata', () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })

    class FooController {
      @LoadTenant
      handler() {
        return 'ok'
      }
    }

    const contributors = getMethodContributors(FooController, 'handler')
    expect(contributors).toHaveLength(1)
    expect(contributors[0]).toBe(LoadTenant.registration)
  })

  it('multiple decorators on the same method push multiple entries (no dedup at this layer)', () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })
    const LoadProject = defineContextDecorator({
      key: 'project',
      resolve: () => ({ id: 'p-1' }),
    })

    class BarController {
      @LoadTenant
      @LoadProject
      handler() {
        return 'ok'
      }
    }

    const contributors = getMethodContributors(BarController, 'handler')
    expect(contributors).toHaveLength(2)
    const keys = contributors.map((c) => c.key)
    expect(keys).toContain('tenant')
    expect(keys).toContain('project')
  })

  it('writes do not leak across different methods on the same class', () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })
    const LoadProject = defineContextDecorator({
      key: 'project',
      resolve: () => ({ id: 'p-1' }),
    })

    class SplitController {
      @LoadTenant
      a() {}
      @LoadProject
      b() {}
    }

    expect(getMethodContributors(SplitController, 'a').map((c) => c.key)).toEqual(['tenant'])
    expect(getMethodContributors(SplitController, 'b').map((c) => c.key)).toEqual(['project'])
  })
})

describe('defineContextDecorator — class decorator', () => {
  it('writes the registration to CLASS_CONTRIBUTORS metadata', () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })

    @LoadTenant
    class TaggedController {}

    const contributors = getClassContributors(TaggedController)
    expect(contributors).toHaveLength(1)
    expect(contributors[0]).toBe(LoadTenant.registration)
  })

  it('multiple class decorators push multiple entries', () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })
    const LoadFlags = defineContextDecorator({
      key: 'flags',
      resolve: () => ({ beta: true }),
    })

    @LoadTenant
    @LoadFlags
    class DoubleTagged {}

    const contributors = getClassContributors(DoubleTagged)
    expect(contributors).toHaveLength(2)
  })

  it('class registrations stay separate from method registrations on the same class', () => {
    const LoadTenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })
    const LoadProject = defineContextDecorator({
      key: 'project',
      resolve: () => ({ id: 'p-1' }),
    })

    @LoadTenant
    class MixedController {
      @LoadProject
      handler() {}
    }

    expect(getClassContributors(MixedController).map((c) => c.key)).toEqual(['tenant'])
    expect(getMethodContributors(MixedController, 'handler').map((c) => c.key)).toEqual(['project'])
  })
})

describe('defineContextDecorator — type inference (compile-time only)', () => {
  it('narrows resolve parameters and return type via type assertions', () => {
    // These checks run at compile time. If the file typechecks, they pass.
    // Asserting the runtime type just lets us verify the test executed.
    const decorator = defineContextDecorator({
      key: 'requestStartedAt',
      resolve: (_ctx: ExecutionContext) => 42 as number,
    })

    const value = decorator.registration.resolve(
      { get: () => undefined, set: () => undefined, requestId: 'r-1' },
      {} as never,
    )
    expect(value).toBe(42)
  })
})
