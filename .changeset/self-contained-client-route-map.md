---
'@forinda/kickjs-cli': minor
---

`kick typegen`: a route map frontends can use without compiling the server

`KickRoutes.Api` infers response types by referencing controller classes, so a
frontend that wants `createClient<KickApi>` has to pull the server's source
graph into its own `tsc` run. On a 1,727-controller app that meant
`experimentalDecorators`, `emitDecoratorMetadata`, a `paths` fallback into
server source, five ambient imports — and a typecheck that went from 1.69s /
819 MB to 10.84s / 4.87 GB, per frontend, per CI run.

`kick typegen` now also emits `.kickjs/types/kick__client.d.ts`: every type
resolved to a literal shape, shared shapes hoisted to local interfaces,
module-scoped, and with no imports at all. The frontend needs one line:

```ts
import type { KickApi } from '../../../api/.kickjs/types/kick__client'
```

Every entry that resolves carries the ambient map's type exactly, because it is
_produced_ from that map — each one resolved through the server's own program
rather than inferred a second time — so moving a frontend across changes no call
sites. A route the resolver cannot resolve is skipped with a warning rather than
guessed at, so a run that warned yields a subset of `KickRoutes.Api`: the types
present are still exact, but one may be missing. `kick typegen --check` gates
staleness in CI.

The file is not refreshed under `kick dev`: resolving the types builds a full
TypeScript program over the server, which is a build-step cost, not a per-save
one. Everything else in `.kickjs/types/` keeps updating on save.

Needs a TypeScript compiler API, declared as an optional peer dependency.
TypeScript 7 ships none, so install `@typescript/typescript6` there. Without
one, `kick typegen` warns and skips this file rather than failing.
