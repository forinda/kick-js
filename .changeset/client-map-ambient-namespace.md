---
'@forinda/kickjs-cli': patch
---

typegen: expose the client route map as an ambient `KickClientApi` namespace

The generated `kick__client.d.ts` now declares a global namespace as well as
exporting its type, so a frontend that lists the file in its tsconfig
`include` needs no import at all:

```ts
export const api = createClient<KickClientApi.Api>({ baseUrl: '/api/v1' })
```

The explicit form still works for anyone who would rather not have a global:

```ts
import type { Api } from '../../server/.kickjs/types/kick__client'
```

Two details the shape depends on. The hoisted `__T<n>` interfaces stay
**module-local** — declaring them at the top level to make them ambient put all
86 of a real app's shapes into the consuming frontend's global scope. And the
namespace is `KickClientApi`, not `KickApi`: `kick__routes.ts` already declares
a global `KickApi`, and both files live in `.kickjs/types`, which the server's
own tsconfig includes — sharing the name made the _server_ fail to compile with
`TS2300: Duplicate identifier 'KickApi'`.
