---
'@forinda/kickjs': minor
'@forinda/kickjs-view': minor
'@forinda/kickjs-cli': patch
---

`ctx.render` and `views.render` are type-checked against your `.kick` templates.

- **Typegen:** `kick typegen` writes `.kickjs/types/kick__views.ts` from every page. Only real template names compile, and the data must include what the page reads.
  - The shape comes from paths and loops.
  - Guarded reads (`@if (x)`, `??`, `?.`, `&&`, ternaries) are optional and nullable.
  - Extra keys are fine.
  - `{ fragment }` renders take just that fragment's needs.
- **Annotations:** `@input user: User` with `@import type { User } from '…'` types a page's data. Pages may now declare `@input`s, and a default (`@input title = 'Home'`) fills in when nobody passes the name; the page's layouts see it.
- **Shared names:** declare what `createViews({ share })` supplies once in `interface KickViewShared`; `kick add views` scaffolds `src/views/shared.d.ts`.
- **Other engines:** `interface KickViewTypeOptions { otherEngines: true }` lets names outside the registry through, for apps that also use `ViewAdapter`.
- **Unchanged without typegen:** an empty registry keeps `ctx.render` as loose as before.
- **New `kickViewsCli({ dir, componentsDir, pipes, validators })`:** configures the view CLI plugin and its typegen; `viewCliPlugin` is `kickViewsCli()`.
- **Type tests now run:** `@forinda/kickjs` and `@forinda/kickjs-view` run their type tests with `vitest --typecheck`.
