---
'@forinda/kickjs-cli': patch
---

`kick add zod | valibot | yup` now installs the schema validator.

The validator is an optional peer of `@forinda/kickjs` (the framework
lazy-loads it), so a project that installs one in any other way hits
`Cannot find module 'zod'` at startup. They weren't in the `kick add`
registry before (`kick add zod` → "Unknown packages: zod"); now they're
first-class entries, so existing projects can add or switch schema libs
in one step. `kick new` already installs the chosen one.
