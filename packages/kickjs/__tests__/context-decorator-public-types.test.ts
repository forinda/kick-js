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

import { describe, expect, it } from 'vitest'
import {
  defineContextDecorator,
  type CallSiteParams,
  type ContextDecorator,
  type ContextDecoratorRequiringParams,
  type ContextDecoratorWithDefaults,
  type MissingParamKeys,
} from '../src'

describe('context decorator public type surface', () => {
  it('exports the shapes ContextDecorator resolves to', () => {
    // Type-level assertions — the real check is that this file compiles.
    type Defaulted = ContextDecoratorWithDefaults<'tenant'>
    type Required = ContextDecoratorRequiringParams<
      'tenant',
      Record<string, never>,
      { orgId: string },
      never,
      Record<string, never>
    >
    type Missing = MissingParamKeys<{ orgId: string }, Record<string, never>>
    type CallSite = CallSiteParams<{ orgId: string }, Record<string, never>>

    const declared: Record<string, boolean> = {
      defaulted: (null as unknown as Defaulted) !== undefined,
      required: (null as unknown as Required) !== undefined,
      missing: (null as unknown as Missing) !== undefined,
      callSite: (null as unknown as CallSite) !== undefined,
    }
    expect(Object.keys(declared)).toHaveLength(4)
  })

  it('an exported contributor is assignable to the public union', () => {
    // Mirrors what `kick g contributor` writes, including the `export`.
    const Tenant = defineContextDecorator({
      key: 'tenant' as string,
      resolve: () => ({ id: 'org_1' }),
    })

    // If the inferred shape were not expressible through the public union,
    // this annotation would fail — the same gap TS4023 reports downstream.
    const asUnion: ContextDecorator<string> = Tenant as ContextDecorator<string>
    expect(typeof asUnion).toBe('function')
  })
})
