---
'@forinda/kickjs': patch
---

Deprecate `defineAugmentation`. It's a no-op at both runtime and the type level — the `declare module '@forinda/kickjs' { … }` block alone provides the augmentation, and the `.kickjs/types/kick__augmentations.d.ts` catalogue it feeds is documentation-only. Prefer a plain `declare module` block with a JSDoc comment on your own interface. `defineAugmentation` and the `kick/augmentations` typegen plugin will be removed in a future major; no behaviour change for now.
