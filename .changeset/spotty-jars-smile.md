---
'@forinda/kickjs-cli': patch
---

Generate DTO schemas against the validation library the project actually installed.

`kick new --schema valibot` (or `yup`) installs exactly one validation library —
the chosen one and no other. But `kick g dto` and the DTOs `kick g module` emits
both hardcoded `import { z } from 'zod'`, so every generated schema on such a
project imported a package that was never installed.

Both now resolve the library from the project's dependencies and emit the
matching source: `v.pipe(v.string(), …)` with `v.InferOutput` for Valibot,
`yup.string().required()` with `yup.InferType` for Yup, unchanged Zod otherwise.
Reading it from the dependency rather than a new config field means projects
scaffolded before this fix are covered without a config migration; a project
with none declared still gets Zod, as before.

The schemas stay unwrapped — no `fromZod` / `fromValibot` — because
`detectSchema()` sniffs the library at runtime and `InferSchemaOutput` reads all
three for typegen.
