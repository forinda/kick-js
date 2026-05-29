---
'@forinda/kickjs': minor
---

Add `defineContextDecorator.withParams<P>()(spec)` and `defineHttpContextDecorator.withParams<P>()(spec)` curried entry points.

Fixes the partial-inference problem on parameterised contributors. The positional `defineContextDecorator<K, D, P, Ctx>(spec)` signature forces adopters to spell `K` and `D` the moment they want to specify the per-call params shape `P` — which drops automatic `deps` inference, so `(ctx, deps, params) => …` resolvers end up with `deps` typed as `Record<string, never>` (or worse, the wrong shape) unless the deps type is duplicated by hand.

The curried form takes only `P`; `K` (from `spec.key` literal), `D` (from `spec.deps` value shape), and `Ctx` all infer from the spec:

```ts
const LoadTenant = defineContextDecorator.withParams<{ source: 'header' | 'subdomain' }>()({
  key: 'tenant',
  deps: { repo: TENANT_REPO }, // D inferred
  paramDefaults: { source: 'header' },
  resolve: (ctx, { repo }, params) => repo.findFor(ctx, params),
})
```

The positional form keeps working unchanged for back-compat.
