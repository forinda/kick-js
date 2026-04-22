import { describe, it, expect, expectTypeOf } from 'vitest'
import { Roles, Can, AUTH_META, POLICY_META } from '@forinda/kickjs-auth'

/**
 * These tests cover both runtime behaviour AND compile-time typing for the
 * narrowed `@Roles` and `@Can` decorators introduced by the auth typed-
 * decorators work.
 *
 * Type-only checks use `expectTypeOf` from vitest. If the file typechecks,
 * the assertions pass. The `// @ts-expect-error` comments at the rejection
 * sites would FAIL THE BUILD if the narrowing regresses (TS would no longer
 * see an error to suppress).
 */

// ── Augmentation under test ─────────────────────────────────────────────

// `id` and `roles` are declared optional here because module augmentation
// is GLOBAL across the project — making them required would force every
// AuthUser literal in every other test file (csrf, adapter, api-key, etc.)
// to satisfy the augmented shape. `Role` narrowing still works against
// `NonNullable<AuthUser['roles']>` so the @Roles assertions below remain
// strict.
declare module '@forinda/kickjs-auth' {
  interface AuthUser {
    id?: string | number
    roles?: ('admin' | 'editor' | 'viewer')[]
  }

  interface PolicyRegistry {
    post: 'create' | 'update' | 'delete' | 'publish'
    user: 'invite' | 'suspend'
  }
}

// ── @Roles — narrowing ──────────────────────────────────────────────────

describe('@Roles — runtime + typing', () => {
  it('accepts roles inside the augmented union', () => {
    class Ctrl {
      @Roles('admin', 'editor')
      handler() {}
    }
    expect(Reflect.getMetadata(AUTH_META.ROLES, Ctrl, 'handler')).toEqual(['admin', 'editor'])
  })

  it('rejects roles outside the augmented union at compile time', () => {
    // The @ts-expect-error guard fails the build if narrowing regresses —
    // proving the typing actually constrains arguments.
    class Ctrl {
      // @ts-expect-error — 'typo' is not assignable to 'admin' | 'editor' | 'viewer'
      @Roles('typo')
      handler() {}
    }
    // Runtime still records whatever was passed (decorator doesn't validate)
    expect(Reflect.getMetadata(AUTH_META.ROLES, Ctrl, 'handler')).toEqual(['typo'])
  })

  it('still implies @Authenticated', () => {
    class Ctrl {
      @Roles('admin')
      handler() {}
    }
    expect(Reflect.getMetadata(AUTH_META.AUTHENTICATED, Ctrl, 'handler')).toBe(true)
  })
})

// ── @Can — narrowing ────────────────────────────────────────────────────

describe('@Can — runtime + typing', () => {
  it('accepts (action, resource) pairs declared in PolicyRegistry', () => {
    class PostCtrl {
      @Can('delete', 'post')
      remove() {}
      @Can('publish', 'post')
      publish() {}
      @Can('invite', 'user')
      invite() {}
    }
    expect(Reflect.getMetadata(POLICY_META.RESOURCE, PostCtrl, 'remove')).toBe('post')
    expect(Reflect.getMetadata(POLICY_META.ACTION, PostCtrl, 'remove')).toBe('delete')
  })

  it('rejects unknown resource at compile time', () => {
    class Ctrl {
      // @ts-expect-error — 'unknown' is not a registered PolicyRegistry resource
      @Can('delete', 'unknown')
      handler() {}
    }
    expect(Reflect.getMetadata(POLICY_META.RESOURCE, Ctrl, 'handler')).toBe('unknown')
  })

  it('rejects action not declared for the chosen resource', () => {
    class Ctrl {
      // @ts-expect-error — 'invite' is not an action on 'post' (it's on 'user')
      @Can('invite', 'post')
      handler() {}
    }
    expect(Reflect.getMetadata(POLICY_META.ACTION, Ctrl, 'handler')).toBe('invite')
  })

  it('still implies @Authenticated', () => {
    class Ctrl {
      @Can('delete', 'post')
      handler() {}
    }
    expect(Reflect.getMetadata(AUTH_META.AUTHENTICATED, Ctrl, 'handler')).toBe(true)
  })
})

// ── Type-only assertions on decorator signatures ───────────────────────

describe('decorator type signatures', () => {
  it('Roles accepts variadic Role union', () => {
    expectTypeOf(Roles).toBeFunction()
    expectTypeOf(Roles).parameter(0).toEqualTypeOf<'admin' | 'editor' | 'viewer'>()
  })

  it('Can accepts (action, resource) generic over PolicyResource', () => {
    expectTypeOf(Can).toBeFunction()
    // The first parameter narrows based on the second; assert resource union directly.
    expectTypeOf(Can).parameter(1).toEqualTypeOf<'post' | 'user'>()
  })
})
