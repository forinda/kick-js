# KickJS DevTools — VS Code Extension

> **Not to be confused with `@forinda/kickjs-devtools`** (the runtime adapter that
> serves `/_debug/*`). This package is the **VS Code editor extension** that
> consumes that adapter's HTTP surface and surfaces it as tree views and a
> dashboard webview inside the editor.

VS Code extension for inspecting running KickJS apps — health, routes, DI container, metrics — surfaced as tree views + a dashboard webview, with a status-bar connection indicator.

## Requirements

Your app must mount `DevToolsAdapter` (Express runtime) so `/_debug/*` is reachable. For
non-dev environments, set a `secret` so the dashboard isn't world-readable:

```ts
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    DevToolsAdapter({
      // secret: env.DEVTOOLS_SECRET,  // require the token (x-devtools-token header or ?token=) on /_debug/*
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

The extension reads the token from VS Code's secret storage — set it with `KickJS: Set DevTools Token…`.

The routes view shows each route's resolved [route flags](https://kickjs.app/guide/route-flags) next to its handler.

## Commands

Everything is under `KickJS:` in the command palette.

- **Inspect:** Connect to App, Inspect Running App, Show Routes, Show DI Container, Show Metrics, Refresh All, Set / Clear DevTools Token
- **Run:** Run Dev Server, Build, Start (Production)
- **Generate:** Module, Controller, Service, Scaffold, and `Generate…` for middleware, guard, contributor, DTO, adapter, plugin, test, and `kick.config.ts`; Remove Module
- **Project:** Add Package, Regenerate Types, Regenerate Agent Docs, Doctor, Check DI Scopes, Info
- **MCP:** Start MCP Server, Initialise MCP Config
- **kick/db** (needs `dbCliPlugin` in `kick.config.ts`): Migrate, Status, Generate Migration, Rollback

Each command runs the matching `kick` CLI command in a shared `KickJS` terminal.

## License

MIT
