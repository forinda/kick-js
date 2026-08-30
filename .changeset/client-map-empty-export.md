---
'@forinda/kickjs-cli': patch
---

typegen: fix the client route map emitted before any route exists

With no routes discovered, the map re-exported `Api` from its own filename:

```ts
export type { Api } from './kick__client'
```

TypeScript rejects that with `TS2303: Circular definition of import alias`, so
a freshly scaffolded project emitted a file that did not compile — the one
moment every new project passes through.

It now mirrors the populated form: a module-local `interface Api {}`, the
ambient `KickClientApi` namespace, and a direct export. Both the namespace and
the explicit-import forms compile.
