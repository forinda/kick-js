---
'@forinda/kickjs-cli': minor
---

Resolve module-level `contributors()` for per-route context-key narrowing.

A module's `contributors()` hook previously degraded the **entire project**: the scanner detected the word `contributors` anywhere and disabled narrowing everywhere, so any project using module-scoped contributors got no benefit from the feature at all. The hook is now attributed to the controllers that module mounts — it and the mounts live on the same module object, so they share a file — and its keys union into those routes exactly as a class-level decorator's would.

```ts
export const AuditModule = defineModule({
  name: 'Audit',
  build: () => ({
    routes: () => ({ path: '/audit', controller: AuditController }),
    contributors: () => [LoadTenant.registration],
  }),
})
```

Routes on `AuditController` now narrow to `'tenant'` with no decorator on the controller at all — and `ctx.require('somethingElse')` on them is a compile error.

Both registration forms are resolved (`X.registration` and `X.with({…}).registration`), in both the `defineModule` object form and the `class X implements AppModule` form.

**Adapter and bootstrap registrations still degrade the project.** They apply app-wide and can't be attributed to any particular route. The classifier isn't a heuristic: `AppModule` declares `contributors?()` and `routes()` as siblings, so a `contributors` member alongside a `routes` member is the module hook, and `bootstrap({ contributors })` / `defineAdapter({ contributors })` / `definePlugin({ contributors })` — which have no sibling `routes` — are not.

Module resolution itself degrades rather than reporting a partial set when the hook isn't a literal array of registration entries (a spread, a helper call, a variable holding the array), or when a controller is mounted by two modules — there, which contributor set applied depends on which mount served the request.
