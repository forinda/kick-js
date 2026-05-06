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

  it('preserves explicitly provided spec fields', async () => {
    let resolveCalls = 0
    let onErrorCalls = 0
    const onError = (): undefined => {
      onErrorCalls++
      return undefined
    }
    const resolve = (): { id: string } => {
      resolveCalls++
      return { id: 'p-1' }
    }

    const decorator = defineContextDecorator({
      key: 'project',
      dependsOn: ['tenant', 'user'],
      optional: true,
      onError,
      resolve,
    })

    expect(decorator.registration.dependsOn).toEqual(['tenant', 'user'])
    expect(decorator.registration.optional).toBe(true)
    // The runner-facing `resolve` and `onError` are wrappers that bake
    // per-call params into the closure, so they're not reference-equal
    // to the spec functions. Verify by behaviour: calling them
    // dispatches to the spec callbacks.
    expect(typeof decorator.registration.resolve).toBe('function')
    expect(typeof decorator.registration.onError).toBe('function')
    await decorator.registration.resolve({} as never, {})
    expect(resolveCalls).toBe(1)
    await decorator.registration.onError!(new Error('x'), {} as never)
    expect(onErrorCalls).toBe(1)
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

  it('sets a meaningful .name so console.log / stack traces are readable', () => {
    const decorator = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })
    expect(decorator.name).toBe('ContextDecorator(tenant)')
  })

  it('captures a stack snapshot on the registration so boot errors point at adopter code', () => {
    const decorator = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 't-1' }),
    })
    expect(typeof decorator.registration.definedAt).toBe('string')
    // The captured stack should reference this test file's path so a
    // boot-time error pointing at it would be actionable.
    expect(decorator.registration.definedAt).toContain('context-decorator.test')
  })
})

describe('defineContextDecorator — boot-time validation', () => {
  it('throws TypeError when spec is null / not an object', () => {
    expect(() =>
      // @ts-expect-error — testing runtime guard
      defineContextDecorator(null),
    ).toThrow(/spec must be an object literal/)
    expect(() =>
      // @ts-expect-error
      defineContextDecorator(42),
    ).toThrow(/spec must be an object literal/)
  })

  it('throws TypeError when spec.key is missing or empty', () => {
    expect(() =>
      defineContextDecorator({
        // @ts-expect-error — testing runtime guard for missing key
        resolve: () => undefined,
      }),
    ).toThrow(/spec\.key must be a non-empty string/)
    expect(() =>
      defineContextDecorator({
        key: '',
        resolve: () => undefined,
      }),
    ).toThrow(/spec\.key must be a non-empty string/)
  })

  it('throws TypeError when spec.resolve is missing or not a function', () => {
    expect(() =>
      defineContextDecorator({
        // @ts-expect-error — testing runtime guard for missing resolve
        key: 'tenant',
      }),
    ).toThrow(/spec\.resolve is required and must be a function/)
    expect(() =>
      defineContextDecorator({
        key: 'tenant',
        // @ts-expect-error
        resolve: 'not-a-function',
      }),
    ).toThrow(/spec\.resolve is required and must be a function/)
  })

  it('throws TypeError when spec.onError is provided but not a function', () => {
    expect(() =>
      defineContextDecorator({
        key: 'tenant',
        resolve: () => undefined,
        // @ts-expect-error — testing runtime guard
        onError: 'oops',
      }),
    ).toThrow(/spec\.onError must be a function/)
  })

  it('throws TypeError when spec.dependsOn is provided but not an array', () => {
    expect(() =>
      defineContextDecorator({
        key: 'tenant',
        resolve: () => undefined,
        // @ts-expect-error — testing runtime guard
        dependsOn: 'tenant',
      }),
    ).toThrow(/spec\.dependsOn must be an array/)
  })

  it('error messages name the offending key when one is available', () => {
    expect(() =>
      defineContextDecorator({
        key: 'tenant',
        resolve: () => undefined,
        // @ts-expect-error
        onError: 42,
      }),
    ).toThrow(/defineContextDecorator\(tenant\)/)
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

describe('parameterised contributors — factory call form', () => {
  // Minimal stub — the surface tests don't need real ALS / Express.
  const stubCtx = (extra: Record<string, unknown> = {}): ExecutionContext =>
    ({
      get: () => undefined,
      set: () => undefined,
      requestId: 'r-1',
      req: { headers: {} },
      ...extra,
    }) as unknown as ExecutionContext

  it('zero-arg decorator applies paramDefaults', async () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: (_ctx, _deps, params) => params.tag,
    })

    @Trace
    class Ctrl {}

    const reg = getClassContributors(Ctrl)
    expect(reg).toHaveLength(1)
    expect(await reg[0].resolve(stubCtx(), {})).toBe('default')
  })

  it('factory-call decorator merges call-site params over paramDefaults', async () => {
    const Trace = defineContextDecorator<
      'trace',
      Record<string, never>,
      { tag: string; level: number }
    >({
      key: 'trace',
      paramDefaults: { tag: 'default', level: 1 },
      resolve: (_ctx, _deps, params) => `${params.tag}:${params.level}`,
    })

    @Trace({ tag: 'method' })
    class Ctrl {}

    const reg = getClassContributors(Ctrl)
    // `level` inherits from paramDefaults; `tag` overrides.
    expect(await reg[0].resolve(stubCtx(), {})).toBe('method:1')
  })

  it('two factory-call decorators on different methods produce independent registrations', async () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: (_ctx, _deps, params) => params.tag,
    })

    class Ctrl {
      @Trace({ tag: 'a' })
      a(): void {}

      @Trace({ tag: 'b' })
      b(): void {}
    }

    const aReg = getMethodContributors(Ctrl, 'a')
    const bReg = getMethodContributors(Ctrl, 'b')
    expect(await aReg[0].resolve(stubCtx(), {})).toBe('a')
    expect(await bReg[0].resolve(stubCtx(), {})).toBe('b')
    // Independent closures — different per-call params, same key.
    expect(aReg[0]).not.toBe(bReg[0])
    expect(aReg[0].key).toBe('trace')
    expect(bReg[0].key).toBe('trace')
  })

  it('.with() builds a registration with merged params for non-decorator sites', async () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: (_ctx, _deps, params) => params.tag,
    })

    const customised = Trace.with({ tag: 'plugin' })
    expect(await customised.registration.resolve(stubCtx(), {})).toBe('plugin')
  })

  it('.registration uses paramDefaults — back-compat for plugin / adapter sites', async () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: (_ctx, _deps, params) => params.tag,
    })

    expect(await Trace.registration.resolve(stubCtx(), {})).toBe('default')
  })

  it('params can carry functions / closures', async () => {
    const Trace = defineContextDecorator<
      'trace',
      Record<string, never>,
      { keyOf: (ctx: ExecutionContext) => string }
    >({
      key: 'trace',
      paramDefaults: { keyOf: () => 'fallback' },
      resolve: (ctx, _deps, params) => params.keyOf(ctx),
    })

    @Trace({
      keyOf: (ctx) =>
        (ctx as unknown as { req: { headers: Record<string, string> } }).req.headers[
          'x-trace-id'
        ] ?? 'none',
    })
    class Ctrl {}

    const reg = getClassContributors(Ctrl)
    const ctx = stubCtx({ req: { headers: { 'x-trace-id': 'abc' } } })
    expect(await reg[0].resolve(ctx, {})).toBe('abc')
  })

  it('throws a descriptive TypeError on factory call with null / array / primitive', () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: (_ctx, _deps, params) => params.tag,
    })
    // Cast to any so TS doesn't catch these — the runtime check is
    // for JS callers (or TS callers who erase via `as any`).
    const callable = Trace as unknown as (...args: unknown[]) => unknown
    expect(() => callable(null)).toThrow(TypeError)
    expect(() => callable([])).toThrow(/array/)
    expect(() => callable(42)).toThrow(/number/)
    // .with() applies the same guard.
    expect(() => (Trace.with as unknown as (p: unknown) => unknown)(null)).toThrow(TypeError)
  })

  it('rejects class instances / Map / Date — they spread to {} and silently drop params', () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: (_ctx, _deps, params) => params.tag,
    })
    const callable = Trace as unknown as (...args: unknown[]) => unknown

    class MyParams {
      tag = 'oops'
    }
    expect(() => callable(new MyParams())).toThrow(/MyParams/)
    expect(() => callable(new Map())).toThrow(/Map/)
    expect(() => callable(new Date())).toThrow(/Date/)

    // Plain objects + Object.create(null) pass.
    expect(() => callable({ tag: 'plain' })).not.toThrow()
    const nullProto = Object.create(null) as { tag: string }
    nullProto.tag = 'null-proto'
    expect(() => callable(nullProto)).not.toThrow()
  })

  it('freezes captured params so a misbehaving resolver cannot mutate them across requests', async () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { counter: number }>({
      key: 'trace',
      paramDefaults: { counter: 0 },
      resolve: (_ctx, _deps, params) => {
        // Attempt to mutate the captured params. Object.freeze is
        // shallow — assignment in strict mode (TS modules are strict)
        // throws.
        expect(() => {
          ;(params as { counter: number }).counter += 1
        }).toThrow(TypeError)
        return params.counter
      },
    })

    @Trace({ counter: 5 })
    class Ctrl {}

    const reg = getClassContributors(Ctrl)
    expect(await reg[0].resolve(stubCtx(), {})).toBe(5)
    // Second invocation sees the original params, not a mutated value.
    expect(await reg[0].resolve(stubCtx(), {})).toBe(5)
  })

  it('@Foo() (zero-arg factory call) returns a decorator using paramDefaults', async () => {
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: (_ctx, _deps, params) => params.tag,
    })

    // Using `Trace()` — the zero-arg factory overload picks
    // `() => ContextDecoratorTarget`, no cast needed.
    const decorator = Trace()
    expect(typeof decorator).toBe('function')

    class Ctrl {}
    decorator(Ctrl)
    const reg = getClassContributors(Ctrl)
    expect(await reg[0].resolve(stubCtx(), {})).toBe('default')
  })

  it('paramDefaults are snapshotted — caller mutating the spec object cannot affect future call sites', async () => {
    const liveDefaults = { tag: 'initial' }
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: liveDefaults,
      resolve: (_ctx, _deps, params) => params.tag,
    })

    // Mutate the original after definition — should NOT leak into
    // future registrations.
    liveDefaults.tag = 'mutated'

    class Ctrl {}
    Trace(Ctrl)

    const reg = getClassContributors(Ctrl)
    expect(await reg[0].resolve(stubCtx(), {})).toBe('initial')
  })

  it('onError receives the per-call params', async () => {
    const errors: { params: { tag: string }; err: unknown }[] = []
    const Trace = defineContextDecorator<'trace', Record<string, never>, { tag: string }>({
      key: 'trace',
      paramDefaults: { tag: 'default' },
      resolve: () => {
        throw new Error('boom')
      },
      onError: (err, _ctx, params) => {
        errors.push({ params, err })
        return 'fallback'
      },
    })

    @Trace({ tag: 'specific' })
    class Ctrl {}

    const reg = getClassContributors(Ctrl)
    let value: unknown
    try {
      value = await reg[0].resolve(stubCtx(), {})
    } catch (err) {
      value = await reg[0].onError!(err, stubCtx())
    }
    expect(value).toBe('fallback')
    expect(errors[0].params).toEqual({ tag: 'specific' })
  })
})
