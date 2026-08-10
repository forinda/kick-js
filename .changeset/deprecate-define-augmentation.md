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

Nothing breaks. Existing calls still emit their catalogue entry and `kick
typegen` still scans for them. Drop the call and keep the
`declare module '@forinda/kickjs'` block, which is what actually types
`ctx.get(...)`.

The scaffolded contributor skill no longer teaches it, and the two deny-list
entries that policed the "keep both in sync" rule now point at the
`declare module` block instead.
