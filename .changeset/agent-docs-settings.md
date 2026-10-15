---
'@forinda/kickjs-cli': patch
---

The generated agent docs say where `defineSettings` sections go: in the module's own `<name>.settings.ts`, not in `src/config`. They're read through `@Inject(Section)` or `Section.get()`.
