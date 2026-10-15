# @forinda/kickjs-vite

Vite integration for KickJS backends: runs the app on Vite's dev server (one port, real `http.Server`), re-evaluates changed server code without a restart, regenerates `.kickjs/types` on save, and strips devtools code from production builds. `kick dev` boots Vite with this plugin; a plain `vite` boot works the same.

## Installation

```bash
pnpm add -D @forinda/kickjs-vite vite unplugin-swc
```

Peers: `vite >= 6`, `@forinda/kickjs`, `express`, and optionally `@forinda/kickjs-cli` (needed only for typegen-on-save). Projects from `kick new` already have it wired:

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import swc from 'unplugin-swc'
import { kickjsVitePlugin, envWatchPlugin } from '@forinda/kickjs-vite'

export default defineConfig({
  oxc: false,
  plugins: [swc.vite(), kickjsVitePlugin({ entry: 'src/index.ts' }), envWatchPlugin()],
})
```

SWC is there for decorator metadata; Vite's own transform does not emit it.

## kickjsVitePlugin

Returns the full plugin array. This is the only plugin most apps need.

```typescript
function kickjsVitePlugin(options?: KickJSPluginOptions): Plugin[]

interface KickJSPluginOptions {
  entry?: string // app entry, relative to the Vite root (default: 'src/index.ts')
  hmr?: HmrOptions
  devtools?: DevtoolsOptions | false // false skips the devtools flag + strip plugins
}

interface HmrOptions {
  silent?: boolean // drop the console line; the `kickjs:hmr` event is still sent
  onInvalidation?: (context: HmrInvalidationContext) => string | undefined | void
}

interface HmrInvalidationContext {
  tokens: readonly string[] // class names, factory entries, or file basenames
  timestamp: number // epoch ms, same value as the `kickjs:hmr` event
}

interface DevtoolsOptions {
  enabled?: boolean // force the flag value
  flagName?: string // default: '__KICKJS_DEVTOOLS__'
}
```

`onInvalidation` replaces the default `HMR invalidated N tokens: …` line: return a string to log it, or nothing to stay silent and route the batch elsewhere.

```typescript
kickjsVitePlugin({
  hmr: { onInvalidation: ({ tokens }) => `rebuilt: ${tokens.join(' · ')}` },
})
```

### What it does in dev

The array is made of focused sub-plugins:

| Plugin                    | Responsibility                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kickjs:core`             | `appType: 'custom'`, port from `server.port` → `PORT` → `3000`, SSR warmup of the entry, keeps `@forinda/kickjs` / `express` / `reflect-metadata` external |
| `kickjs:module-discovery` | Notes exported `*Module` classes while Vite transforms them                                                                                                |
| `kickjs:hmr`              | Maps changed files to DI tokens and invalidates them (see below)                                                                                           |
| `kickjs:virtual-modules`  | `virtual:kickjs/app` — re-exports your entry                                                                                                               |
| `kickjs:dev-server`       | Pipes Vite's `http.Server` to the app and forwards requests to it                                                                                          |
| `kickjs:typegen`          | Typegen-on-save for plain `vite` boots                                                                                                                     |
| `kickjs:devtools-flag`    | Defines `__KICKJS_DEVTOOLS__` (unless `devtools: false`)                                                                                                   |
| `kickjs:devtools-strip`   | Removes devtools-kit code on `vite build` (unless `devtools: false`)                                                                                       |

**httpServer piping.** Vite creates the server (no `middlewareMode`), and the plugin stores it on `globalThis.__kickjs_httpServer` (and the Vite server on `globalThis.__kickjs_viteServer`). `bootstrap()` sees that global and attaches to the existing server instead of listening itself, so adapters that need `server.on('upgrade', …)` — WebSockets, Socket.IO — get the real server through `afterStart({ server })`. The app is loaded once the server is listening, so a broken entry is reported at startup rather than on the first request.

**Request flow.** Vite's own middleware (HMR client, assets) runs first. Anything it does not handle reaches a post-middleware that loads `virtual:kickjs/app` through `ssrLoadModule()` and hands the request to the exported `app.handle(req, res, next)`; errors get their stack traces fixed with `ssrFixStacktrace()`.

**HMR.** Changes under the project source are batched over 150 ms. For each batch the plugin calls `container.invalidate(token)` for every affected `@Service` / `@Controller` / `@Repository` / `@Injectable` / `@Component` class (and its dependents) and notes `defineAdapter` / `definePlugin` / `defineContextDecorator` entries, invalidates the virtual app so the next load re-imports fresh code, re-warms the app, and sends a `kickjs:hmr` custom event (`{ tokens, timestamp }`) that DevTools and Swagger UI listen for. Files with no tracked token still trigger the reload, labelled by basename. Guide: [HMR](../guide/hmr.md).

## kickjsTypegenPlugin

Included in `kickjsVitePlugin()`; exported for custom compositions. Serve-only.

```typescript
function kickjsTypegenPlugin(options?: TypegenPluginOptions): Plugin

interface TypegenPluginOptions {
  loadCli?: (root: string) => Promise<TypegenCliModule | null> // test seam
}
```

When nothing has claimed typegen ownership (`kick dev` claims it before booting Vite), it resolves `@forinda/kickjs-cli` from the project's `node_modules`, loads `kick.config`, runs one catch-up pass, then feeds Vite's watcher events into the CLI's [`createTypegenDevWatcher`](./cli.md#createtypegendevwatcher). Failures are logged and sent as a `kickjs:typegen-error` event. Without the CLI installed it logs a one-line notice and does nothing. Guide: [Typegen](../guide/typegen.md).

## envWatchPlugin

Not part of `kickjsVitePlugin()` — add it alongside.

```typescript
function envWatchPlugin(): Plugin
```

Watches `.env`, `.env.local`, `.env.development`, `.env.production` and `.env.test` in the Vite root. On change it calls `reloadEnv()` from `@forinda/kickjs`, invalidates `src/index.ts`, and sends a full reload. Guide: [Configuration](../guide/configuration.md).

## Devtools build flag

```typescript
function devtoolsFlagPlugin(options?: DevtoolsFlagOptions): Plugin
function resolveDevtoolsFlag(options?: DevtoolsFlagOptions, env?: ConfigEnv): boolean

interface DevtoolsFlagOptions {
  enabled?: boolean
  flagName?: string // default: '__KICKJS_DEVTOOLS__'
}
```

Defines a boolean global through Vite's `define`. Its value: `enabled` if set, else `KICKJS_DEVTOOLS=1|true|0|false`, else `true` under `vite serve` and `false` under `vite build` (outside Vite, `NODE_ENV !== 'production'`). Gate devtools imports on it and the branch is tree-shaken from production bundles. For the type, reference `@forinda/kickjs-vite/globals`:

```typescript
/// <reference types="@forinda/kickjs-vite/globals" />

if (__KICKJS_DEVTOOLS__) {
  const { DevToolsAdapter } = await import('@forinda/kickjs-devtools')
  adapters.push(DevToolsAdapter())
}
```

Guide: [DevTools](../guide/devtools.md).

## Devtools strip

```typescript
function devtoolsStripPlugin(options?: DevtoolsStripOptions): Plugin
function stripDevtoolsCode(
  source: string,
  filename: string,
  options?: { fastReject?: boolean }, // default true: skip files that never mention devtools-kit
): { code: string; changed: boolean }

interface DevtoolsStripOptions {
  enabled?: boolean // default: on for `vite build`
  include?: RegExp // default: /\.(?:m|c)?[jt]sx?$/
}
```

On build, removes every `@forinda/kickjs-devtools-kit` import (any subpath), top-level expression statements rooted in one of its bindings (e.g. `defineDevtoolsTab({...})`), and side-effect imports ending in `devtools-events`. Files in `node_modules` are skipped. A devtools-kit call inside a function body is left alone, so the build fails once its import is gone — gate that call behind `__KICKJS_DEVTOOLS__`.

## Related

- [HMR](../guide/hmr.md) and [HMR with decorators](../guide/tutorial-hmr-decorators.md)
- [Typegen](../guide/typegen.md)
- [CLI Commands — `kick dev`](../guide/cli-commands.md#kick-dev)
