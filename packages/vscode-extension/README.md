# KickJS DevTools (VS Code Extension)

VS Code extension for inspecting running KickJS applications — routes, DI container, metrics, and health monitoring.

## Features

- **Health monitoring** — live status, uptime, error rate, adapter states
- **Routes tree** — grouped by controller with method icons (GET, POST, DELETE, etc.)
- **DI Container** — view all registrations with scope and instantiation status
- **Dashboard** — webview panel with health, metrics, route table with search/filter
- **Status bar** — connection indicator showing healthy/disconnected state
- **Auto-refresh** — polls every 30 seconds (configurable)

## Requirements

Your KickJS app must have `DevToolsAdapter` enabled, which exposes the `/_debug` endpoints:

```ts
import { DevToolsAdapter } from '@forinda/kickjs-devtools'

bootstrap({
  modules,
  adapters: [new DevToolsAdapter()],
})
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `kickjs.serverUrl` | `http://localhost:3000` | URL of the running KickJS app |
| `kickjs.debugPath` | `/_debug` | Base path for DevTools endpoints |
| `kickjs.autoRefresh` | `true` | Auto-refresh data every 30 seconds |

## Commands

| Command | Description |
|---------|-------------|
| `KickJS: Inspect Running App` | Open the dashboard webview |
| `KickJS: Show Routes` | Refresh the routes tree |
| `KickJS: Show DI Container` | Refresh the container tree |
| `KickJS: Show Metrics` | Refresh the health/metrics tree |

## Development

```bash
pnpm build         # Build the extension
pnpm dev           # Watch mode
pnpm test          # Run unit tests
```

## License

MIT
