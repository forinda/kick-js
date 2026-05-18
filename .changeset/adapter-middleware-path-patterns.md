---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': patch
---

feat(http): widen AdapterMiddleware.path + tighten handler typing + clarify lifecycle docs

Three improvements to the adapter middleware contract, surfacing from a real-world bug-report investigation that found no bug — just sharp edges:

**1. Widened path scope.** `AdapterMiddleware.path` now accepts `string | RegExp | (string | RegExp)[]` (new `MiddlewarePath` type, exported from `@forinda/kickjs`) instead of a bare `string`. Mirrors Express's native `app.use(path, …)` shape so adopters get the full range without learning a new mini-language:

```ts
middleware() {
  return [
    { handler: rateLimit(), phase: 'beforeRoutes', path: ['/api', '/admin'] },
    { handler: csrf(), phase: 'afterGlobal', path: /^\/api\/v\d+\//, },
    { handler: bodyLog({ region: 'eu' }), phase: 'afterGlobal', path: ['/api', /^\/internal\//] },
  ]
}
```

The framework copies readonly arrays before passing to Express (`PathParams` requires a mutable array), so adopters can declare paths with `as const` without any runtime workaround.

**2. Tighter `handler` typing.** `AdapterMiddleware.handler` is now `RequestHandler | ErrorRequestHandler` instead of `any`. Adapters that ship error-handling middleware get type checking; the union resolves via Express's arity-based dispatch.

**3. Lifecycle JSDoc clarified.** The `MiddlewarePhase` JSDoc spells out the `afterRoutes` semantics — fires **only on fall-through** (no route matched, or a handler called `next()` without ending the response). Controllers that respond with `ctx.json(…)` end the chain and skip this phase. For per-response work (logging, metrics) the doc points adopters at `res.on('finish', …)` from an earlier phase instead. The `kick g middleware` generator template now embeds the same guidance so freshly scaffolded middleware files explain phase trade-offs at the point of use.

New tests in `__tests__/adapter-middleware-path-patterns.test.ts` exercise every path shape (string prefix, array of strings, single RegExp, mixed array, `as const` readonly array, omitted). The existing `lifecycle-mount-order.test.ts` continues to lock in the order semantics.
