import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'

import { extractFile, resolveRouteContextKeys } from '../src/typegen/scanner'
import type { DiscoveredContextKey, DiscoveredRoute } from '../src/typegen/scanner'

const CWD = resolve('/proj')
const CONTROLLER = resolve('/proj/src/users/user.controller.ts')

// Per-route context-key narrowing exists so a dropped `@LoadTenant`
// becomes a tsc error instead of an undefined riding into an auth check.
// Its correctness rests entirely on one rule: prove the route's full
// contributor set, or emit nothing and let it stay unnarrowed. These
// tests are mostly about the "or emit nothing" half — an over-narrow
// union turns a legitimate `ctx.require()` into a false compile error.

function routesFrom(source: string, filePath = CONTROLLER): DiscoveredRoute[] {
  return extractFile(source, filePath, CWD).routes
}

const CONTRIBUTOR: DiscoveredContextKey[] = [
  {
    key: 'tenant',
    exportName: 'LoadTenant',
    filePath: resolve('/proj/src/contributors/tenant.ts'),
    relativePath: 'src/contributors/tenant.ts',
  },
  {
    key: 'operatorPerm',
    exportName: 'OperatorPerm',
    filePath: resolve('/proj/src/contributors/perm.ts'),
    relativePath: 'src/contributors/perm.ts',
  },
]

function keysFor(source: string, contextKeys = CONTRIBUTOR, hasGlobal = false) {
  const routes = routesFrom(source)
  resolveRouteContextKeys(routes, contextKeys, hasGlobal)
  return routes.map((r) => r.contextKeys)
}

describe('context-key extraction', () => {
  it('captures the binding a contributor is assigned to', () => {
    const extract = extractFile(
      `import { defineHttpContextDecorator } from '@forinda/kickjs'
       export const LoadTenant = defineHttpContextDecorator({
         key: 'tenant',
         resolve: (ctx) => ctx.req.headers['x-tenant-id'],
       })`,
      resolve('/proj/src/contributors/tenant.ts'),
      CWD,
    )
    expect(extract.contextKeys).toEqual([
      expect.objectContaining({ key: 'tenant', exportName: 'LoadTenant' }),
    ])
  })

  it('captures the binding through the curried withParams form', () => {
    const extract = extractFile(
      `import { defineHttpContextDecorator } from '@forinda/kickjs'
       export const OperatorPerm = defineHttpContextDecorator.withParams<{ action: string }>()({
         key: 'operatorPerm',
         resolve: (ctx, _d, p) => p.action,
       })`,
      resolve('/proj/src/contributors/perm.ts'),
      CWD,
    )
    expect(extract.contextKeys[0]).toMatchObject({
      key: 'operatorPerm',
      exportName: 'OperatorPerm',
    })
  })

  it('records a null binding for a non-const-initialiser call', () => {
    const extract = extractFile(
      `import { defineContextDecorator } from '@forinda/kickjs'
       export const list = [defineContextDecorator({ key: 'inline', resolve: () => 1 })]`,
      resolve('/proj/src/contributors/inline.ts'),
      CWD,
    )
    expect(extract.contextKeys[0]).toMatchObject({ key: 'inline', exportName: null })
  })
})

describe('resolveRouteContextKeys — narrows only what it can prove', () => {
  it('resolves method-level decorators to their keys', () => {
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../contributors/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([['tenant']])
  })

  it('includes class-level decorators on every method', () => {
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../contributors/tenant'
        import { OperatorPerm } from '../contributors/perm'
        @LoadTenant
        @Controller()
        export class UserController {
          @OperatorPerm({ action: 'read' })
          @Get('/')
          list(ctx) {}
          @Get('/:id')
          one(ctx) {}
        }`),
    ).toEqual([['operatorPerm', 'tenant'], ['tenant']])
  })

  it('resolves the factory-call form as well as the bare form', () => {
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { OperatorPerm } from '../contributors/perm'
        @Controller()
        export class UserController {
          @OperatorPerm({ action: 'audit:read' })
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([['operatorPerm']])
  })

  it('proves the empty set for a route with no contributors', () => {
    // `[]` (not null) — the scanner is asserting this route carries none,
    // so `ctx.require()` on it should be a compile error.
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        @Controller()
        export class UserController {
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([[]])
  })

  it('ignores known contributor-free framework decorators', () => {
    expect(
      keysFor(`
        import { Controller, Get, Middleware, Public } from '@forinda/kickjs'
        import { LoadTenant } from '../contributors/tenant'
        @Controller()
        export class UserController {
          @Public()
          @Middleware(someFn)
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([['tenant']])
  })

  // ── the degradation cases — where correctness actually lives ────────

  it('degrades on an unrecognised decorator', () => {
    // An adopter decorator can bundle contributors of its own (the
    // composition recipe does exactly that), so "unknown" cannot be
    // treated as "harmless".
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { WithAudit } from '../decorators/audit'
        @Controller()
        export class UserController {
          @WithAudit
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([null])
  })

  it('degrades every route when contributors are registered outside decorators', () => {
    const src = `
      import { Controller, Get } from '@forinda/kickjs'
      import { LoadTenant } from '../contributors/tenant'
      @Controller()
      export class UserController {
        @LoadTenant
        @Get('/')
        list(ctx) {}
      }`
    // Provable on its own...
    expect(keysFor(src)).toEqual([['tenant']])
    // ...but a module/adapter/bootstrap registration anywhere in the
    // project adds keys to routes that carry no decorator for them.
    expect(keysFor(src, CONTRIBUTOR, true)).toEqual([null])
  })

  it('disambiguates two same-named contributors via the import specifier', () => {
    // Two `LoadTenant` exports in different files. The name alone is
    // ambiguous, but the import says which one, so this still narrows.
    const ambiguous: DiscoveredContextKey[] = [
      ...CONTRIBUTOR,
      {
        key: 'otherTenant',
        exportName: 'LoadTenant',
        filePath: resolve('/proj/src/other/tenant.ts'),
        relativePath: 'src/other/tenant.ts',
      },
    ]
    expect(
      keysFor(
        `
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../contributors/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`,
        ambiguous,
      ),
    ).toEqual([['tenant']])

    // ...and pointing at the other file picks up the other key.
    expect(
      keysFor(
        `
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../other/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`,
        ambiguous,
      ),
    ).toEqual([['otherTenant']])
  })

  it('degrades when an alias specifier suffix-matches more than one file', () => {
    // `@/contributors/tenant` is matched by path suffix (tsconfig paths
    // aren't parsed), so two files whose paths both end that way are
    // genuinely ambiguous — refuse rather than pick one.
    const ambiguous: DiscoveredContextKey[] = [
      CONTRIBUTOR[0],
      {
        key: 'nestedTenant',
        exportName: 'LoadTenant',
        filePath: resolve('/proj/src/features/contributors/tenant.ts'),
        relativePath: 'src/features/contributors/tenant.ts',
      },
    ]
    expect(
      keysFor(
        `
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '@/contributors/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`,
        ambiguous,
      ),
    ).toEqual([null])
  })

  it('does not credit a same-named decorator imported from elsewhere', () => {
    // The route imports `LoadTenant` from a third-party package that has
    // nothing to do with the project's own contributor of that name.
    // Matching on the identifier alone would narrow this route to
    // 'tenant' — a key it never actually carries.
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '@acme/auth'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([null])
  })

  it('resolves a relative import to the declaring file', () => {
    // Same identifier, and the specifier really does point at the file
    // that declares it.
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../contributors/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([['tenant']])
  })

  it('degrades when a relative import points at a different file', () => {
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../elsewhere/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([null])
  })

  it('resolves the `@/` path alias that `kick new` scaffolds', () => {
    // tsconfig `paths: { '@/*': ['./src/*'] }` is what the CLI emits, so
    // alias imports are the norm in adopter projects; degrading on them
    // would switch the feature off for most codebases.
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '@/contributors/tenant'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([['tenant']])
  })

  it('resolves a same-file contributor', () => {
    const routes = routesFrom(
      `import { Controller, Get, defineHttpContextDecorator } from '@forinda/kickjs'
       const LoadTenant = defineHttpContextDecorator({ key: 'tenant', resolve: () => 1 })
       @Controller()
       export class UserController {
         @LoadTenant
         @Get('/')
         list(ctx) {}
       }`,
    )
    resolveRouteContextKeys(
      routes,
      [{ key: 'tenant', exportName: 'LoadTenant', filePath: CONTROLLER, relativePath: 'x' }],
      false,
    )
    expect(routes[0].contextKeys).toEqual(['tenant'])
  })

  it('degrades when the decorator binding cannot be resolved to an import', () => {
    // No import statement and no same-file const — we matched the name
    // but can't be confident it's that contributor.
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        @Controller()
        export class UserController {
          @LoadTenant
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([null])
  })

  it('degrades a route with no decorator list at all (regex fallback)', () => {
    const routes: DiscoveredRoute[] = [{ appliedDecorators: undefined } as DiscoveredRoute]
    resolveRouteContextKeys(routes, CONTRIBUTOR, false)
    expect(routes[0].contextKeys).toBeNull()
  })

  it('degrades — rather than partially narrowing — when one of several is unknown', () => {
    // The dangerous shape: two resolvable decorators and one unknown.
    // Emitting just the two would look like a complete set.
    expect(
      keysFor(`
        import { Controller, Get } from '@forinda/kickjs'
        import { LoadTenant } from '../contributors/tenant'
        import { OperatorPerm } from '../contributors/perm'
        import { Mystery } from '../decorators/mystery'
        @Controller()
        export class UserController {
          @LoadTenant
          @OperatorPerm({ action: 'x' })
          @Mystery
          @Get('/')
          list(ctx) {}
        }`),
    ).toEqual([null])
  })
})
