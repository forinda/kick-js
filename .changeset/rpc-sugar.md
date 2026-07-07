---
'@forinda/kickjs-client': minor
'@forinda/kickjs-cli': minor
---

feat: tRPC-style RPC sugar — `createRpc(api, kickRpc)`

```ts
import { kickRpc } from './.kickjs/types/kick__routes'

const rpc = createRpc(api, kickRpc)
const task = await rpc.tasks.get({ params: { id: '42' } }) // typed end to end
```

- `kick typegen` now also emits a runtime `kickRpc` manifest in
  `kick__routes.ts` (`controller.method → 'VERB /mounted/path'`, friendly
  namespaces: `TasksController` → `tasks`; stays in lockstep with the
  `KickRoutes.Api` map incl. duplicate handling)
- `createRpc` builds a plain typed namespace over the existing client — no
  Proxy, no new inference; required params/body enforced, SSE routes typed
  `never` (use `api.stream`)
