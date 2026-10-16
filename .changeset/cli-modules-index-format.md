---
'@forinda/kickjs-cli': patch
---

`kick g module` and `kick rm module` write `src/modules/index.ts` through the same format-on-write step as every other generated file, so the added `.mount(...)` comes out oxfmt-formatted instead of on a hand-indented line.
