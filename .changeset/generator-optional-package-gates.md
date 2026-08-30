---
'@forinda/kickjs-cli': patch
---

generators: stop emitting imports for packages the project does not have

Two generators wrote code referring to optional packages whether or not the
project depended on them, producing files that could not compile:

- `kick g module` / `kick g scaffold` emitted
  `import { ApiTags } from '@forinda/kickjs-swagger'` plus five `@ApiTags(...)`
  decorators. The `rest` template does not install swagger, so a generated
  module in a fresh project was broken on arrival — and nobody asked for
  swagger.
- `kick g job` emitted `import { … } from '@forinda/kickjs-queue'`. That
  generator is removed outright rather than gated — a queue processor's shape
  belongs to whichever queue you run. Add your own with `defineGenerator`.

The decorators are now emitted only when the project declares the dependency.
Both read `package.json` rather than resolving from `node_modules`: what a
project declares is what its generated code may import, and a transitively
installed copy is not a dependency to rely on.

`kick new` was already correct — its swagger and devtools imports are gated on
`--packages`, which also installs them.
