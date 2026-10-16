---
'@forinda/kickjs-cli': patch
---

Generated code passes the scaffold's own oxlint and oxfmt: the `kick g module` service no longer imports `HttpException` it never uses, the Inertia template's `src/config/index.ts` no longer has a line past 100 columns, and `kick g` formats what it writes with the CLI's own oxfmt when the project has none installed (as after `vp migrate`), instead of leaving it unformatted.
