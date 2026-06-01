---
'@forinda/kickjs': minor
---

Add a `ContextKeys` registry so augmenting `ContextMeta` no longer breaks `dependsOn` on unrelated context decorators.

`ContextMeta` was doing double duty: the value-type registry for `ctx.get`/`set` AND (via `keyof ContextMeta`) the valid-key registry for `dependsOn`. So the moment a project augmented `ContextMeta` for some keys, any contributor that `dependsOn`-ed a key you hadn't added to `ContextMeta` stopped compiling (`Type '"session"' is not assignable to type '"tenant" | "user"'`) — even though it was a perfectly valid contributor key.

`dependsOn` is now typed against the **union** of `keyof ContextMeta` and the new key-only `ContextKeys` registry:

```ts
declare module '@forinda/kickjs' {
  interface ContextMeta {
    tenant: { id: string; name: string }
  } // typed ctx.get
  interface ContextKeys {
    session: true
  } // dependsOn-able, value stays unknown
}
```

Adding a value type via `ContextMeta` now always makes that key a valid `dependsOn` target, and you can register a dependsOn-able key without inventing a value type for it. Typo-protection and the empty-registry `string` fallback are preserved. Non-breaking: existing `ContextMeta`-only projects keep working unchanged.
