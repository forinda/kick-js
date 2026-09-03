---
'@forinda/kickjs': minor
---

`KickRouteFlags` — route flags get the same type safety contributors have.

Flag names were plain strings, so a typo produced a flag that silently never matched. Declare them once and every use narrows:

```ts
declare module '@forinda/kickjs' {
  interface KickRouteFlags {
    'auth.public': true
    'rate.limit': { rpm: number }
  }
}
```

- `defineRouteFlag('auth.pubic')` is a compile error, with TypeScript's "Did you mean" suggestion
- `defineRouteFlag('rate.limit')` infers `RouteFlag<{ rpm: number }>` from the registry — the explicit generic is no longer needed (and still works)
- `ctx.route.flags.get('rate.limit')` is typed `{ rpm: number } | undefined` instead of `unknown`, and `has()` takes only declared names
- `skipWhen`, `onlyWhen` and `exemptWhen` accept only declared names, in every consumer

Additive and opt-in: `KickRouteFlags` is empty by default, and every one of those falls back to plain `string` / `unknown` while it stays empty — a project that declares nothing keeps compiling unchanged, and flags can be adopted one at a time. Same `[Known] extends [never]` fallback `ContextMetaKey` uses.

The framework declares no flags of its own in the registry.
