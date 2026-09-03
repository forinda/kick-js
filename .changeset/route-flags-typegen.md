---
'@forinda/kickjs-cli': minor
---

`kick typegen` generates the `KickRouteFlags` registry.

Every `defineRouteFlag('name')` call in `src/` is collected into `.kickjs/types/kick__route-flags.d.ts`, so declaring the flag is the only step — no hand-written `declare module` block:

```ts
// src/flags.ts — all you write
export const Public = defineRouteFlag('auth.public')
export const Limit = defineRouteFlag<{ rpm: number }>('rate.limit')
```

```ts
// .kickjs/types/kick__route-flags.d.ts — generated, refreshed on every `kick dev` save
declare module '@forinda/kickjs' {
  interface KickRouteFlags {
    'auth.public': true
    'rate.limit': { rpm: number }
  }
}
```

From there a misspelt flag name is a compile error at every consumer (`skipWhen`, `onlyWhen`, `exemptWhen`, `flags.has`), and `flags.get('rate.limit')` is typed rather than `unknown`.

Unlike the `ContextKeys` registry, this one records the **value type** too: a bare flag registers as `true`, an explicit generic registers that type verbatim. Empty project emits an empty registry and every name falls back to `string`.

Disable it like any other plugin: `typegen: { disable: ['kick/route-flags'] }`.
