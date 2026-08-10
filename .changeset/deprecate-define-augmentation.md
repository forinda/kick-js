---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': patch
---

Deprecate `defineAugmentation`.

It existed to publish a typegen catalogue of augmentable interfaces, from when
Context Contributors were still settling and adopters needed to discover what
could be augmented. Contributors are a stable typed API now, so the catalogue
buys nothing while costing a second call that has to be kept in step with the
`declare module` block — and which never contributed a single type. Forgetting
one of the pair was itself a documented footgun.

Nothing breaks. `kick typegen` still discovers the call and still writes the
catalogue. Drop it and keep the `declare module '@forinda/kickjs'` block, which
is what actually types `ctx.get(...)`.

Verified against the real pipeline rather than the docstring: a call emits one
empty marker interface in `.kickjs/types/kick__augmentations.d.ts` —

```ts
export interface ContextMetaAugmentation {}
```

with the description and example as its JSDoc and a `@see` to the call site.
The interface is empty and unreferenced, so nothing consumes it at type level.

That check also turned up the catalogue's filename being wrong in five places —
the JSDoc, both public guides, and two inline comments all still named the
legacy `augmentations.d.ts` rather than the `kick__augmentations.d.ts` the
plugin has been writing. Corrected, and both guides now carry the deprecation.

The scaffolded contributor skill no longer teaches it, and the two deny-list
entries that policed the "keep both in sync" rule now point at the
`declare module` block instead.
