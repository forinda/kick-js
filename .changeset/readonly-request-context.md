---
'@forinda/kickjs': minor
---

`RequestContext.body`, `params`, `query`, `headers`, `file`, and `files`
are now typed `DeepReadonly<T>` (or `Readonly<T>` for headers,
`ReadonlyArray<...>` for files). This is a **type-only** change — no
runtime difference, no `Object.freeze`, no perf cost — but adopter code
that mutates these in place will start failing at compile time:

```ts
// Before — silently accepted, even when bypassing Zod validation
ctx.body.injectedField = 'computed'
ctx.headers.authorization = 'fake'
ctx.files.push(extra)

// After — tsc errors
//   "Cannot assign to 'injectedField' because it is a read-only property."
//   "Cannot assign to 'authorization' because it is a read-only property."
//   "Property 'push' does not exist on type 'readonly ..."
```

This matches the framework's existing rule — _writes flow through
`ctx.set(key, value)` or a Context Contributor's return value, not by
mutating the request bag in place_ — and now the type system enforces
it.

### Migration

Most usages already comply. If you mutate one of these surfaces
intentionally, two escape hatches:

1. **Compute and stash** (preferred):
   ```ts
   const enriched = { ...ctx.body, computed: f(ctx.body) }
   ctx.set('enrichedBody', enriched)
   ```
2. **Drop down to the raw Express handle**:
   ```ts
   ;(ctx.req.body as any).injectedField = 'computed'
   ```

The escape hatches stay supported. The default just stops surprising
adopters who validated a payload with Zod, then watched a downstream
middleware silently mutate it.

`ctx.session`, `ctx.user`, `ctx.cookies`, and `ctx.requestId` are
unchanged — those have legitimate write-side flows (auth strategies,
session stores, etc.) and wrapping them in `Readonly` would create
real friction.

A new `DeepReadonly<T>` type alias is exported from
`@forinda/kickjs` for adopters who want to apply the same lock to
their own typed payloads.
