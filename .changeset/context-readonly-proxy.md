---
'@forinda/kickjs': patch
---

fix(http): drop `DeepReadonly<>` from RequestContext getters; runtime warns via dev-only Proxy instead

`RequestContext.{body,params,query,headers,file,files}` used to return `DeepReadonly<T>` (and `Readonly<>` for `headers`). The recursive conditional type interfered with TS narrowing — discriminated unions on `ctx.body`, drilldown into nested Zod-inferred shapes, and IDE jump-to-type all degraded — and slowed type-checking on deeply-nested payloads.

The compile-time wrapper is gone. Runtime read-only enforcement now lives in a private `makeReadOnlyProxy()` helper:

- **Dev (`NODE_ENV !== 'production'`)** — `ctx.body` returns a `Proxy` over `req.body` whose `set` / `deleteProperty` traps `console.warn` and leave the underlying object untouched. Strict-mode-safe (traps return `true`), so `ctx.body.foo = 'x'` doesn't throw mid-handler — it just warns + ignores the write.
- **Production** — the Proxy is bypassed entirely; getters return `req.body` / `req.params` / etc. as-is. Zero overhead on the hot path.
- Wrappers are cached per-target on `req` via a Symbol, so repeat access of `ctx.body` returns the same Proxy instance (stable under `===` across middleware / contributor / handler boundaries — relied on by router-builder's multi-RequestContext-per-request layout).

The `DeepReadonly<T>` utility type stays exported (still useful for adopters who want to seal their own shapes). It just isn't applied to the framework's request getters anymore.

Runtime read behavior is unchanged for callers — `ctx.body.email` still reads the email — but the TypeScript contract changed: assignment is no longer a compile-time error and now warns at dev time at runtime. Adopters who relied on the compile-time block should keep doing what they were doing (the contract is documented in JSDoc + warned at runtime). The Proxy is deep: nested mutations like `ctx.body.user.name = 'x'`, `ctx.files[0].fieldname = 'y'`, and `ctx.body.tags.push(...)` all surface the same warning, matching the prior `DeepReadonly<T>` depth at runtime instead of at the type level.
