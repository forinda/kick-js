/**
 * Shared `ContextMeta` augmentation for the test suite.
 *
 * `ContextMetaKey` narrows from `string` to the declared keys as soon as
 * `ContextMeta` has ANY member — that is the intended app-level DX. But
 * module augmentation is global to a TypeScript program, and every file
 * under `__tests__` compiles as one program. So a single suite augmenting
 * `ContextMeta` (it was `parameterised-contributors-tenant-flow.test.ts`,
 * adding `tenant` and `tenantDb`) silently invalidated the keys used by
 * every other suite — 38 type errors in files that had done nothing wrong.
 * Runtime was unaffected, since types erase, which is why it went unnoticed.
 *
 * Declaring the whole suite's keys in one place fixes that. The values are
 * `any` deliberately: different suites legitimately use the same key with
 * different fixture shapes (`tenant` alone appears with a dozen), so no
 * single precise type exists. Narrowing them would mean rewriting fixtures
 * across ~20 files to satisfy a constraint that only exists to serve app
 * authors, not this suite.
 *
 * The type-level behaviour this gives up — that an augmented `ContextMeta`
 * actually constrains keys and value types — is covered in isolation by
 * `context-decorator-public-types.test.ts`, which compiles under its own
 * program via `tsconfig.typetests.json`.
 */

declare module '../src/core/execution-context' {
  interface ContextMeta {
    a: any
    after: any
    allOptional: any
    analytics: any
    audit: any
    b: any
    bad: any
    bad2: any
    c: any
    cached: any
    'check-locale': any
    d: any
    defaultedAction: any
    empty: any
    fail: any
    fast: any
    'feature-flag': any
    flags: any
    flaky: any
    fromAdapter: any
    fromGlobal: any
    fromModuleA: any
    fromModuleB: any
    fromPlugin: any
    greeting: any
    hard: any
    hijacked: any
    'hook-bomb': any
    locale: any
    maybe: any
    noParams: any
    ok: any
    partiallyDefaulted: any
    pick: any
    project: any
    recovered: any
    requestStartedAt: any
    requiresAction: any
    runtimeDefaulted: any
    runtimeGuard: any
    slow: any
    standalone: any
    tenant: any
    tenantDb: any
    // Read via `ctx.require` / `ctx.get` rather than declared by a `key:`.
    tenantPerm: any
    lookup: any
    // Used via `ctx.get` / `ctx.set` on a RequestContext rather than declared
    // by a contributor `key:`.
    flag: any
    shared: any
    val: any
    legacy: any
    anything: any
    trace: any
    // Written by the `traceContext()` middleware into the request store, so
    // `getRequestValue('traceId')` reads them typed rather than `unknown`.
    traceId: string
    spanId: string
    traceFlags: string
    traceVersion: string
    user: any
    who: any
    'will-throw': any
    x: any
  }
}

export {}
