# Migrating to the Pluggable-Runtimes Release

This release makes the HTTP engine **pluggable** — KickJS now runs on Express,
Fastify, or h3. It's a major version because the public surface around the HTTP
layer changed, but for the common case the upgrade is a no-op.

## TL;DR

- **Express apps need no code changes.** Express stays the zero-config default;
  existing apps behave exactly as before.
- **New:** opt into another engine with one line —
  `bootstrap({ modules, runtime: fastifyRuntime() })`. See
  [HTTP Runtimes](./http-runtimes.md).
- A few **type** and **adapter-author** details changed; they're listed below.

## For app authors

### Nothing required

Your controllers speak `RequestContext`, not Express, so they already run on any
engine. `bootstrap({ modules })` keeps using Express. Done.

### Optional: make the runtime explicit

New projects scaffolded with `kick new` now emit the runtime explicitly:

```ts
import { bootstrap, expressRuntime } from '@forinda/kickjs'

export const app = await bootstrap({ modules, runtime: expressRuntime() })
```

You don't have to add this to existing apps — it's purely for clarity and to
make switching engines a one-line edit. To switch:

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify' // pnpm add fastify @fastify/middie
// or
import { h3Runtime } from '@forinda/kickjs/h3' // pnpm add h3
```

### Response-helper return types

`ctx.json()` / `ctx.html()` / `ctx.problem.*` and friends now return
`RuntimeResponse` instead of Express's `Response`. The value is almost never
consumed (handlers just call the helper and return), so this rarely matters. If
you stored it — `const r: Response = ctx.json(...)` — drop the annotation or use
`ctx.res` for the raw engine response.

### `getExpressApp()` → `getRuntimeApp()`

`app.getExpressApp()` still works but is **deprecated**. Prefer
`app.getRuntimeApp()`, which returns the engine-native app typed from the active
runtime.

## For adapter authors

### Use `ctx.http` instead of `ctx.app`

`AdapterContext` gained an engine-agnostic **`http`** surface — the supported way
to add routes, mounts, static dirs, and middleware:

```ts
beforeMount({ http }) {
  http.route('GET', '/_my/panel', (ctx) => ctx.html(PANEL))
  http.serveStatic('/_my/assets', assetsDir)
  http.use(myConnectMiddleware)
}
```

`ctx.app` is still available as the engine-native escape hatch (Express by
default), but an adapter written against `ctx.http` works on every runtime.

### `AdapterContext.app` is now runtime-typed

`AdapterContext.app` and `getRuntimeApp()` are typed `ActiveRuntime['app']` —
`Express` by default. If you build a **mock** `AdapterContext` in tests, it now
needs an `http` entry alongside `app`.

## Deprecated packages

`@forinda/kickjs-auth`, `@forinda/kickjs-prisma`, `@forinda/kickjs-drizzle`, and
the `@forinda/kickjs-db-{pg,mysql,sqlite}` shims are frozen — they stay installed
and working at their last published version, but no longer receive updates. See
their READMEs for the recommended replacements (BYO auth via context decorators,
`@forinda/kickjs-db` with its `/pg` · `/mysql` · `/sqlite` subpaths).

## Trying it early

Preview builds publish under the `@alpha` npm channel:

```bash
pnpm add @forinda/kickjs@alpha
```

See [Release channels](./getting-started.md#release-channels).
