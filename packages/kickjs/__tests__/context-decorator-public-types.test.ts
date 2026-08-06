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
 * stops compiling. `tsc --noEmit` runs over `__tests__`, so that is a build
 * failure, not just a red test.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  defineContextDecorator,
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
      key: 'tenant' as string,
      resolve: () => ({ id: 'org_1' }),
    })

    // Assigned WITHOUT a cast on purpose: a cast would satisfy the compiler
    // whatever the inferred shape was, leaving this asserting nothing. The
    // bare annotation IS the check — if the shape were not expressible through
    // the public union this line fails, which is the gap TS4023 reports
    // downstream.
    const asUnion: ContextDecorator<string> = Tenant
    expect(typeof asUnion).toBe('function')
  })
})
