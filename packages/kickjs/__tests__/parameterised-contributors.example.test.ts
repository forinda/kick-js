/**
 * End-to-end recipe for parameterised context contributors.
 *
 * This is the canonical example the docs cookbook links to. It
 * exercises the full surface — `defineContextDecorator(...)` with
 * `paramDefaults`, the `.with(params)` registration accessor, the
 * topo-sorted runner — to prove that per-call params propagate
 * cleanly from each call site through to `resolve()`.
 *
 * The "tenant from header / subdomain / JWT claim" shape is the
 * canonical SaaS multi-tenant case; defining `LoadTenant` inside the
 * test (rather than in any framework package) keeps the example
 * adopter-portable. Adopters copy this verbatim into their own
 * codebase.
 *
 * @module @forinda/kickjs/__tests__/parameterised-contributors.example
 */

import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  Container,
  buildPipeline,
  defineContextDecorator,
  runContributors,
  type ExecutionContext,
} from '../src/core'

beforeEach(() => {
  Container.reset()
})

/**
 * Minimal `ExecutionContext` shaped to look like a Request — just
 * enough surface for `LoadTenant.resolve()` to read headers /
 * hostname. Adopter projects use the real `RequestContext`; the
 * runner doesn't care.
 */
function makeRequestCtx(req: {
  headers?: Record<string, string>
  hostname?: string
  user?: { tenantId?: string }
}): ExecutionContext {
  const store = new Map<string, unknown>()
  return {
    get<K extends string>(key: K) {
      return store.get(key) as never
    },
    set<K extends string>(key: K, value: never) {
      store.set(key, value)
    },
    requestId: 'req-example',
    // The runner only sees the typed `ExecutionContext` surface; the
    // request-shaped extras are exposed via a cast inside `resolve`.
    req: { headers: {}, hostname: 'localhost', ...req },
  } as unknown as ExecutionContext
}

describe('parameterised contributors — end-to-end recipe', () => {
  /**
   * Per-call params shape. The literal-union `source` discriminates
   * the resolver branch; the optional fields apply only to specific
   * branches.
   */
  type LoadTenantParams = {
    source: 'header' | 'subdomain' | 'jwt'
    headerName?: string
  }

  /**
   * One framework decorator definition; adopters apply it with
   * different params per controller / route.
   *
   * Note that `params` is the wide union inside `resolve()` — TS
   * narrows it via the `if (params.source === '...')` checks. This
   * matches the chosen "wide narrowing" convention from plan.md
   * (Decision 1 / Q4).
   */
  const LoadTenant = defineContextDecorator<'tenant', Record<string, never>, LoadTenantParams>({
    key: 'tenant',
    paramDefaults: { source: 'header', headerName: 'x-tenant-id' },
    resolve: (ctx, _deps, params) => {
      const req = (
        ctx as unknown as {
          req: { headers: Record<string, string>; hostname: string; user?: { tenantId?: string } }
        }
      ).req
      if (params.source === 'header') {
        return req.headers[params.headerName ?? 'x-tenant-id'] ?? null
      }
      if (params.source === 'subdomain') {
        // Strip the leading subdomain — `acme.example.com` → `acme`.
        return req.hostname.split('.')[0]
      }
      // 'jwt' — read from the user object set by an upstream auth contributor.
      return req.user?.tenantId ?? null
    },
  })

  it('captures header-source params and resolves the tenant', async () => {
    const ctx = makeRequestCtx({ headers: { 'x-org-id': 'acme' } })
    const pipeline = buildPipeline([
      {
        source: 'method',
        registration: LoadTenant.with({ source: 'header', headerName: 'x-org-id' }).registration,
      },
    ])

    await runContributors({ pipeline, ctx, container: Container.getInstance() })

    expect(ctx.get('tenant' as never)).toBe('acme')
  })

  it('captures subdomain-source params and resolves the tenant', async () => {
    const ctx = makeRequestCtx({ hostname: 'globex.example.com' })
    const pipeline = buildPipeline([
      {
        source: 'method',
        registration: LoadTenant.with({ source: 'subdomain' }).registration,
      },
    ])

    await runContributors({ pipeline, ctx, container: Container.getInstance() })

    expect(ctx.get('tenant' as never)).toBe('globex')
  })

  it('captures JWT-source params and resolves the tenant', async () => {
    const ctx = makeRequestCtx({ user: { tenantId: 'cyberdyne' } })
    const pipeline = buildPipeline([
      {
        source: 'method',
        registration: LoadTenant.with({ source: 'jwt' }).registration,
      },
    ])

    await runContributors({ pipeline, ctx, container: Container.getInstance() })

    expect(ctx.get('tenant' as never)).toBe('cyberdyne')
  })

  it('zero-arg `.registration` falls back to paramDefaults (header source)', async () => {
    // Adopter who doesn't need to override params just uses the bare
    // `.registration` — equivalent to `LoadTenant.with({}).registration`
    // because every required field has a default.
    const ctx = makeRequestCtx({ headers: { 'x-tenant-id': 'default-tenant' } })
    const pipeline = buildPipeline([{ source: 'method', registration: LoadTenant.registration }])

    await runContributors({ pipeline, ctx, container: Container.getInstance() })

    expect(ctx.get('tenant' as never)).toBe('default-tenant')
  })
})
