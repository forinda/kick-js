# @forinda/kickjs-vite

Vite plugin for KickJS — single-port dev server, HMR, virtual modules, and `http.Server` piping for adapters (WebSocket, GraphQL subscriptions, etc.).

## Install

```bash
pnpm add -D @forinda/kickjs-vite vite unplugin-swc
```

## Quick Example

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false,
  plugins: [
    swc.vite(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    envWatchPlugin(),
  ],
  ssr: { external: ['pino', 'pino-pretty'] },
  build: { target: 'node20', ssr: true, outDir: 'dist' },
})
```

```ts
// src/index.ts
import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'

export const app = await bootstrap({ modules })
```

The plugin reads the exported `app` from the entry file, mounts Express on Vite's HTTP server (single port for both Vite assets + KickJS API), and gives HMR-aware reloads. `envWatchPlugin()` triggers a full reload when `.env` changes so config tweaks land without a manual restart.

## Documentation

[forinda.github.io/kick-js/guide/vite-plugin](https://forinda.github.io/kick-js/guide/vite-plugin)

## License

MIT
