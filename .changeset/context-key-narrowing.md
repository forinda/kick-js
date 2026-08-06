---
'@forinda/kickjs': minor
'@forinda/kickjs-testing': patch
---

Narrow every key-taking surface to the declared `ContextMeta` / `ContextKeys` keys

Augmenting `ContextMeta` narrowed `dependsOn` and nothing else. `key` on a
contributor spec, `ctx.get`, `ctx.set`, `ctx.require` and `getRequestValue` were
all `K extends string`, so in a fully augmented app a typo'd key still compiled
and failed at runtime — or silently read `undefined`.

The two questions are different and only one was being asked:

- `TKeys` — "does **this route** carry the key?" `get` deliberately stays loose
  here, because claiming presence wrongly fails open.
- `ContextMetaKey` — "does this key exist in the app **at all**?" An undeclared
  key here is a typo, not a maybe-absent value.

All key positions now use `ContextMetaKey`. Value types were already correct and
are unchanged: `ctx.get('user')` is `User | undefined`, `ctx.require('user')` is
`User`, and a key registered only in `ContextKeys` still reads as `unknown`.

`ContextMetaKey` moved next to the registries it reads in `execution-context`,
so that module can constrain `get`/`set` without a circular import. It is still
re-exported from `context-decorator`, so existing imports are unaffected.

Framework-internal positions that also said `string` — `AnyContributorRegistration`,
`RequestContext<TKeys>`, the typegen fallback, and `runContributor` in
`@forinda/kickjs-testing` — moved with them. Those were latent: they stopped
satisfying the constraint the moment any consumer augmented `ContextMeta`.

**Back-compat:** with no augmentation `ContextMetaKey` _is_ `string`, so nothing
changes. Augmented apps get compile errors where they previously had silent
typos — which is the point of augmenting.
