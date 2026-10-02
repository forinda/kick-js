---
'@forinda/kickjs': major
'@forinda/kickjs-cli': minor
---

`defineAugmentation` is removed, with the `kick/augmentations` typegen plugin and its `.kickjs/types/kick__augmentations.d.ts` catalogue. It was deprecated since 7.2 and did nothing at runtime or at the type level — the `declare module '@forinda/kickjs' { … }` block was always what typed an augmentation. Delete the calls; keep the `declare module` blocks. `kick typegen` sweeps the old `kick__augmentations.d.ts` from existing projects.
