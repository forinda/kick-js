import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { defineContextDecorator } from '../src/index'

// Before this, `paramDefaults` was the only way to satisfy a required
// field of `P`, so contributors that genuinely need a per-call-site
// value ended up with invented defaults — `action: 'settings:read'` on a
// permission contributor every call site overrides. A route that then
// forgot the argument silently gated on the placeholder instead of
// failing to compile. Now: undefaulted required fields are mandatory at
// each call site, and `requiredParams` enforces the same thing at
// runtime for JS / `as any` call sites.

type PermParams = { action: string; scope?: string }

const NoParams = defineContextDecorator({
  key: 'noParams',
  resolve: () => 'ok',
})

const AllOptional = defineContextDecorator.withParams<{ scope?: string }>()({
  key: 'allOptional',
  resolve: (_ctx, _deps, p) => p.scope ?? 'default',
})

const RequiresAction = defineContextDecorator.withParams<PermParams>()({
  key: 'requiresAction',
  resolve: (_ctx, _deps, p) => p.action,
})

const DefaultedAction = defineContextDecorator.withParams<PermParams>()({
  key: 'defaultedAction',
  paramDefaults: { action: 'read' },
  resolve: (_ctx, _deps, p) => p.action,
})

const PartiallyDefaulted = defineContextDecorator.withParams<{
  action: string
  tenant: string
}>()({
  key: 'partiallyDefaulted',
  paramDefaults: { tenant: 'default' },
  resolve: (_ctx, _deps, p) => `${p.tenant}:${p.action}`,
})

describe('required params — compile-time', () => {
  it('keeps the bare + .registration forms for zero-param contributors', () => {
    // Back-compat: the overwhelmingly common case must be untouched.
    NoParams(class Bare {})
    expect(NoParams.registration.key).toBe('noParams')
  })

  it('keeps the bare form when every param is optional', () => {
    AllOptional(class Bare {})
    expect(AllOptional.registration.key).toBe('allOptional')
  })

  it('keeps the bare form when paramDefaults covers the required field', () => {
    DefaultedAction(class Bare {})
    expect(DefaultedAction.registration.key).toBe('defaultedAction')
  })

  it('rejects every param-less form when a required field is undefaulted', () => {
    // @ts-expect-error — bare class-decorator application can't supply `action`
    RequiresAction(class Bare {})
    // @ts-expect-error — bare method-decorator application can't supply `action`
    RequiresAction({}, 'someMethod')
    // @ts-expect-error — `{}` is missing `action`
    RequiresAction({})
    // @ts-expect-error — `.registration` has no way to supply `action`
    void RequiresAction.registration
    // @ts-expect-error — `.with({})` is missing `action`
    RequiresAction.with({})

    // The supported forms still type-check.
    RequiresAction({ action: 'audit:read' })
    RequiresAction({ action: 'audit:read', scope: 'org' })
    expect(RequiresAction.with({ action: 'audit:read' }).registration.key).toBe('requiresAction')
  })

  it('requires only the fields paramDefaults did not cover', () => {
    // @ts-expect-error — `action` is still undefaulted
    PartiallyDefaulted({ tenant: 'acme' })

    PartiallyDefaulted({ action: 'read' })
    PartiallyDefaulted({ action: 'read', tenant: 'acme' })
  })
})

describe('required params — runtime (requiredParams)', () => {
  const Runtime = defineContextDecorator.withParams<{ action: string }>()({
    key: 'runtimeGuard',
    requiredParams: ['action'],
    resolve: (_ctx, _deps, p) => p.action,
  })

  // Every call below goes through `as any` on purpose — these are the
  // paths the type system can't see (plain JS, dynamic params).
  const untyped = Runtime as any

  it('throws on a factory call missing the param', () => {
    expect(() => untyped({})).toThrow(TypeError)
    expect(() => untyped({})).toThrow(/missing required param\(s\) 'action'/)
  })

  it('throws on bare decorator application', () => {
    expect(() => untyped(class Bare {})).toThrow(/bare `@decorator` usage/)
  })

  it('throws on .registration access', () => {
    expect(() => untyped.registration).toThrow(/`\.registration`/)
  })

  it('throws on .with() missing the param', () => {
    expect(() => untyped.with({})).toThrow(/`\.with\(\)`/)
  })

  it('names the decorator and suggests the fix', () => {
    expect(() => untyped({})).toThrow(/defineContextDecorator\(runtimeGuard\)/)
    expect(() => untyped({})).toThrow(/paramDefaults/)
  })

  it('accepts the call once the param is supplied', () => {
    expect(() => Runtime({ action: 'read' })).not.toThrow()
    expect(Runtime.with({ action: 'read' }).registration.key).toBe('runtimeGuard')
  })

  it('treats a defaulted required param as satisfied', () => {
    const Defaulted = defineContextDecorator.withParams<{ action: string }>()({
      key: 'runtimeDefaulted',
      requiredParams: ['action'],
      paramDefaults: { action: 'read' },
      resolve: (_ctx, _deps, p) => p.action,
    })
    expect(() => Defaulted(class Bare {})).not.toThrow()
    expect(Defaulted.registration.key).toBe('runtimeDefaulted')
  })

  it('rejects a malformed requiredParams at definition time', () => {
    expect(() =>
      defineContextDecorator({
        key: 'bad',
        // @ts-expect-error — deliberately malformed
        requiredParams: 'action',
        resolve: () => 1,
      }),
    ).toThrow(/requiredParams must be an array/)

    expect(() =>
      // `['']` is a well-typed `string[]`, so only the runtime guard
      // catches it — which is exactly the class of call site this
      // validation exists for.
      defineContextDecorator({
        key: 'bad2',
        requiredParams: [''],
        resolve: () => 1,
      }),
    ).toThrow(/requiredParams entries must be non-empty strings/)
  })
})
