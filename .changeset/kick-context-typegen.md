---
'@forinda/kickjs-cli': minor
---

Add the `kick/context` typegen plugin — auto-populate `ContextKeys` from context-decorator key literals.

`kick typegen` now scans every `defineContextDecorator({ key })` / `defineHttpContextDecorator({ key })` call (including the curried `.withParams<T>()({ key })` form) and emits `.kickjs/types/kick__context.d.ts` augmenting the `ContextKeys` registry. This makes a Context Contributor's `dependsOn` typo-checked automatically — no hand-maintained registry, and no need to give a key a value type in `ContextMeta` just to depend on it.

Pairs with the `ContextKeys` registry: `dependsOn` narrows to `keyof ContextMeta | keyof ContextKeys`, so the generated augmentation feeds typo-checking while `ContextMeta` keeps driving `ctx.get(key)` value types. The plugin skips emission when no context decorators are found. Scanner gains `extractContextKeysFromSource` + `ScanResult.contextKeys`.
