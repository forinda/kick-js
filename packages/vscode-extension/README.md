# KickJS DevTools (VS Code Extension)

VS Code extension for inspecting running KickJS apps — health, routes, DI container, metrics — surfaced as tree views + a dashboard webview, with a status-bar connection indicator.

## Requirements

Your app must mount `DevToolsAdapter` so `/_debug/*` is reachable:

```ts
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [DevToolsAdapter()],
})
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `kickjs.serverUrl` | `http://localhost:3000` | Where the app is running |
| `kickjs.debugPath` | `/_debug` | DevTools mount path |
| `kickjs.autoRefresh` | `true` | Poll every 30s |

Commands: `KickJS: Inspect Running App`, `Show Routes`, `Show DI Container`, `Show Metrics`.

## License

MIT
