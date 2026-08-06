/**
 * Every type reachable from the public `ContextDecorator` union must be
 * exported from the package root.
 *
 * Exporting the union alone is not enough. `defineContextDecorator()` infers
 * one of the two concrete interfaces the union resolves to, so a consumer
 * writing the ordinary thing —
 *
 *   export const Tenant = defineContextDecorator({ ... })
 *
 * — makes TypeScript emit a declaration for `Tenant`, and it cannot name a
 * type it has no import path to:
 *
 *   TS4023: Exported variable 'Tenant' has or is using name
 *   'ContextDecoratorWithDefaults' from external module … but cannot be named
 *
 * Every file `kick g contributor` produces is exactly that shape, so all of
 * them failed `tsc --noEmit` in a scaffolded app while the framework's own
 * build stayed green — same-project types are always nameable, which is why
 * this only ever shows up downstream.
 *
 * The imports below are the guard: drop one of these re-exports and this file
 * stops compiling. It is `tsconfig.typetests.json` — wired into the package's
 * `typecheck` script — that compiles it; the default `tsconfig.json` is
 * `include: ["src"]` and never sees `__tests__`.
 *
 * This file guards the CAUSE (the types staying exported). It cannot reproduce
 * TS4023 itself, because everything here resolves through `../src` and a type
 * in the same program is always nameable. `dts-consumer-emit.test.ts` covers
 * the emit path against the built `.d.mts`.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  defineContextDecorator,
  getRequestValue,
  type CallSiteParams,
  type ContextDecorator,
  type ContextDecoratorRequiringParams,
  type ContextDecoratorWithDefaults,
  type ExecutionContext,
  type MissingParamKeys,
} from '../src'

describe('context decorator public type surface', () => {
  it('resolves the union to the exported defaulted shape', () => {
    // The union's own default type args carry no required params, so it must
    // land on the `WithDefaults` branch — and both names have to be public
    // for this line to compile at all.
    expectTypeOf<ContextDecorator<'tenant'>>().toEqualTypeOf<
      ContextDecoratorWithDefaults<'tenant'>
    >()
  })

  it('resolves the union to the exported required-params shape', () => {
    // A param with no default flips the conditional to the other branch.
    //
    // `NoDefaults` is `Record<never, never>`, NOT `Record<string, never>`:
    // the latter's `keyof` is `string`, so `Exclude<'orgId', keyof PD>`
    // collapses to `never` and the type silently reports "everything is
    // defaulted" — the assertion would then pass against the wrong branch.
    type Params = { orgId: string }
    type NoDefaults = Record<never, never>

    expectTypeOf<
      ContextDecorator<'project', Record<string, never>, Params, ExecutionContext, NoDefaults>
    >().toEqualTypeOf<
      ContextDecoratorRequiringParams<
        'project',
        Record<string, never>,
        Params,
        ExecutionContext,
        NoDefaults
      >
    >()
  })

  it('exports the helpers used in those shapes public positions', () => {
    // `MissingParamKeys` drives the conditional above; `CallSiteParams` is the
    // argument type of the factory / `.with()` forms. Both appear in emitted
    // declarations, so both must be nameable downstream.
    expectTypeOf<
      MissingParamKeys<{ orgId: string }, Record<never, never>>
    >().toEqualTypeOf<'orgId'>()
    // No defaults, so the undefaulted required field is mandatory at the call
    // site rather than merely optional.
    expectTypeOf<CallSiteParams<{ orgId: string }, Record<never, never>>>().toEqualTypeOf<
      Partial<{ orgId: string }> & Pick<{ orgId: string }, 'orgId'>
    >()
  })

  it('an exported contributor is assignable to the public union', () => {
    // Mirrors what `kick g contributor` writes, including the `export`.
    const Tenant = defineContextDecorator({
      key: 'tenant',
      resolve: () => ({ id: 'org_1' }),
    })

    // Assigned WITHOUT a cast on purpose: a cast would satisfy the compiler
    // whatever the inferred shape was, leaving this asserting nothing. The
    // bare annotation IS the check — if the shape were not expressible through
    // the public union this line fails, which is the gap TS4023 reports
    // downstream.
    const asUnion: ContextDecorator<'tenant'> = Tenant
    expect(typeof asUnion).toBe('function')
  })
})

/**
 * Once `ContextMeta` / `ContextKeys` are augmented, an undeclared key must be
 * a compile error on EVERY surface that takes one — not just `dependsOn`.
 *
 * It used to be only `dependsOn`. `key`, `get`, `set`, `require` and
 * `getRequestValue` all said `K extends string`, so in a fully augmented app a
 * typo'd key compiled fine and failed at runtime (or silently read
 * `undefined`). The two questions are genuinely different — "does this route
 * carry the key" (`TKeys`, deliberately loose on `get`) versus "does this key
 * exist in the app at all" (`ContextMetaKey`) — and only the first was ever
 * being asked.
 *
 * These assertions are meaningful only because `tsconfig.typetests.json` pulls
 * in `context-meta.d.ts`. Without it the registry is empty, `ContextMetaKey`
 * collapses to `string`, and every `@ts-expect-error` below would report as
 * unused.
 */
describe('declared keys narrow every key-taking surface', () => {
  it('rejects an undeclared key on a decorator spec', () => {
    defineContextDecorator({
      // @ts-expect-error — 'not-a-declared-key' is in neither registry
      key: 'not-a-declared-key',
      resolve: () => 1,
    })
    expect(true).toBe(true)
  })

  // Declared, never called: these are compile-time assertions, and invoking
  // them against a stub context would just throw.
  function _undeclaredKeysRejected(ctx: ExecutionContext): void {
    // @ts-expect-error — undeclared key
    ctx.get('not-a-declared-key')
    // @ts-expect-error — undeclared key
    ctx.set('not-a-declared-key', 1)
    // @ts-expect-error — undeclared key
    ctx.require('not-a-declared-key')
    // Standalone reader, outside any context object — it was the clearest
    // instance of the bug (its docblock promised to thread the augmented
    // shape while leaving the key `string`), so it needs its own case.
    // @ts-expect-error — undeclared key
    getRequestValue('not-a-declared-key')
  }

  function _declaredKeyAccepted(ctx: ExecutionContext): void {
    // `tenant` is declared, so none of these are errors.
    ctx.get('tenant')
    ctx.set('tenant', undefined)
    getRequestValue('tenant')
  }

  it('exposes the compile-time guards above', () => {
    expect(typeof _undeclaredKeysRejected).toBe('function')
    expect(typeof _declaredKeyAccepted).toBe('function')
  })
})
