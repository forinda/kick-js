# @forinda/kickjs-vite

Vite plugin for KickJS server applications. Provides virtual modules, module auto-discovery, selective HMR, and dev server integration.

## Installation

```bash
pnpm add -D @forinda/kickjs-vite
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { kickjs } from '@forinda/kickjs-vite'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [kickjs(), swc.vite()],
})
```

## Plugin Composition

`kickjs()` returns an array of 5 focused plugins:

| Plugin | Responsibility |
|--------|---------------|
| `kickjs:core` | Base config — Node 20 target, SSR externals |
| `kickjs:virtual-modules` | Virtual module resolution (`virtual:kickjs/server-entry`, `virtual:kickjs/app-modules`) |
| `kickjs:module-discovery` | Auto-discovers `@Controller`, `@Service`, `@Repository` via transform hook |
| `kickjs:hmr` | Selective DI invalidation on file changes, config file restart |
| `kickjs:dev-server` | Configures Vite for backend dev (middlewareMode, SSR environment) |

## Options

```ts
kickjs({
  entry: 'src/index.ts',  // Server entry file (default: 'src/index.ts')
})
```

## Typegen

Generate typed `container.resolve()` calls from decorated classes:

```ts
import { generateContainerTypes } from '@forinda/kickjs-vite'

// One-shot generation
generateContainerTypes(process.cwd(), 'src')

// Or use the CLI
// kick typegen
// kick typegen --watch
```

Output: `.kickjs/types/container.d.ts` with `ContainerTokenMap` interface.

## Virtual Modules

| Module ID | Description |
|-----------|-------------|
| `virtual:kickjs/server-entry` | Re-exports the user's entry file |
| `virtual:kickjs/app-modules` | Aggregates all discovered decorated modules |

## HMR Behavior

- **Decorated file changes**: Virtual modules invalidated, `kickjs:module-update` HMR event sent
- **Config file changes** (`kick.config.ts`): Full server restart
- **Other files**: Standard Vite HMR flow
