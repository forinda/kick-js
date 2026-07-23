---
'@forinda/kickjs-cli': minor
---

Resolve app-level `contributors: [...]` for per-route context-key narrowing.

A `bootstrap({ contributors })` registration previously degraded the whole project — narrowing switched off everywhere. It's now resolved and its keys union into every route, since app-level contributors apply to all of them and need no attribution. `createWebApp()` and `new Application()` take the same `ApplicationOptions` and are handled identically.

```ts
export const app = bootstrap({
  modules,
  contributors: [LoadTenant.registration],
})
```

Every route in the app now narrows to include `'tenant'`, and `ctx.require('somethingElse')` is a compile error.

Note the shape difference this had to accommodate: `ApplicationOptions.contributors` is an **array** (`ContributorRegistrations`) where `AppModule.contributors` is a **hook** (`(): ContributorRegistrations`). The extractor accepts both.

**Adapter and plugin `contributors()` still degrade the project.** Their bodies ship from packages typegen can't read, so the keys they add to every route are unknowable. A first-party `defineAdapter` in the adopter's own `src/` is in principle resolvable, but `defineAdapter` exposes `contributors()` from its `build()` return rather than the options top level, and an adapter imported from `node_modules` is indistinguishable at the point of use — resolving only the local case would narrow some projects and not others for reasons invisible in the source. Left out deliberately.

With this, four of the five registration sites resolve: method decorator, class decorator, module hook, and bootstrap option. Degradation still applies for an unrecognised decorator, an unresolvable import, an ambiguous name, a registration list that isn't a literal array of `X.registration` / `X.with(…).registration` entries, and a controller mounted by two modules.
