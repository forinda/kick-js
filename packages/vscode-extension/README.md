# KickJS DevTools — VS Code Extension

> **Not to be confused with `@forinda/kickjs-devtools`** (the runtime adapter that
> serves `/_debug/*`). This package is the **VS Code editor extension** that
> consumes that adapter's HTTP surface and surfaces it as tree views and a
> dashboard webview inside the editor.

VS Code extension for inspecting running KickJS apps — health, routes, DI container, metrics — surfaced as tree views + a dashboard webview, with a status-bar connection indicator.

## Requirements

Your app must mount `DevToolsAdapter` so `/_debug/*` is reachable. For
non-dev environments, set a `secret` so the dashboard isn't world-readable:

```ts
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    DevToolsAdapter({
      // secret: env.DEVTOOLS_SECRET,  // production: require ?secret=… on every /_debug/* request
      // enabled: env.NODE_ENV !== 'production',  // or gate the adapter off entirely outside dev
    }),
  ],
})
```

## Settings

| Setting              | Default                 | Description              |
| -------------------- | ----------------------- | ------------------------ |
| `kickjs.serverUrl`   | `http://localhost:3000` | Where the app is running |
| `kickjs.debugPath`   | `/_debug`               | DevTools mount path      |
| `kickjs.autoRefresh` | `true`                  | Poll every 30s           |

Commands: `KickJS: Inspect Running App`, `Show Routes`, `Show DI Container`, `Show Metrics`.

## License

MIT
