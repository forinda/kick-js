# @forinda/kickjs-vite

Vite plugin for KickJS — single-port dev server, HMR, virtual modules, and
`http.Server` piping for adapters (WebSocket, GraphQL subscriptions, etc.).

## Install

```bash
pnpm add -D @forinda/kickjs-vite vite unplugin-swc
```

`vite` (>=6) and `express` (^5) are peer dependencies.

## Quick Start

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { kickjsVitePlugin } from '@forinda/kickjs-vite'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [
    swc.vite({ tsconfigFile: 'tsconfig.json' }),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
  ],
})
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import express from 'express'
import { UserModule } from './modules/users/user.module'

// Export the app — Vite serves it in dev, you start it in prod
export const app = bootstrap({
  modules: [UserModule],
  middleware: [express.json()],
})

if (process.env.NODE_ENV === 'production') {
  app.start()
}
```

Then run `vite` (or `kick dev`) and the Express app is mounted on Vite's HTTP
server. Edits trigger selective HMR — only the affected modules re-register in
the DI container, so DB pools, Redis clients, and WebSocket connections stay
alive across reloads.

## What you get

- **Single-port dev server** — Express is mounted on Vite's HTTP server, so
  one URL serves both your API and any Vite-managed assets.
- **Selective HMR** — only changed modules re-register in the KickJS
  container; DB pools, Redis clients, and WebSocket connections stay alive
  across reloads.
- **Adapter-friendly** — KickJS adapters (`WsAdapter`, GraphQL subscriptions,
  etc.) attach to the dev `http.Server` through the standard
  `afterStart({ server })` hook with zero extra wiring.
- **Auto-generated entry** — discovered modules are wired into the app
  automatically; no manual entry boilerplate.

## Options

```ts
interface KickJSPluginOptions {
  /** Path to app entry file, relative to Vite root. Default: 'src/index.ts' */
  entry?: string
}
```

## `envWatchPlugin()` — `.env` file hot-reload

Watches `.env`, `.env.local`, `.env.development`, `.env.production`, and
`.env.test`, and triggers a full Vite reload whenever any of them change.
Compose it alongside `kickjsVitePlugin()`:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'
import swc from 'unplugin-swc'

export default defineConfig({
  plugins: [
    swc.vite({ tsconfigFile: 'tsconfig.json' }),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
    envWatchPlugin(),
  ],
})
```

> **Moved.** This used to live in `@forinda/kickjs-config`. The old export
> still exists as a back-compat shim and prints a deprecation warning;
> migrate to `@forinda/kickjs-vite` before v3.

`envWatchPlugin()` pairs naturally with the merged `ConfigService`
(`@forinda/kickjs`) — once a `.env` change triggers a reload, the next
`loadEnv()` call re-validates `process.env` against your Zod schema.

## With the CLI

If you use `kick dev` from `@forinda/kickjs-cli`, this plugin is wired up
automatically — no manual `vite.config.ts` is required for typical projects.

## Documentation

[Full documentation](https://github.com/forinda/kick-js)

## License

MIT
