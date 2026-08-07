# SPA Integration

Serve a Vue, React, Svelte, or Angular build alongside your KickJS API. API routes are handled by controllers; all other GET requests fall back to `index.html` for client-side routing.

## Setup

```ts
import { bootstrap } from '@forinda/kickjs'
import { SpaAdapter } from '@forinda/kickjs/spa'

bootstrap({
  modules: [...],
  adapters: [
    SpaAdapter({
      clientDir: 'dist/client',
      apiPrefix: '/api',
    }),
  ],
})
```

Works under every runtime — Express, Fastify, and h3 — because the adapter is
written against the engine-agnostic `http` surface rather than `express.static`.

## How It Works

1. Static files in `clientDir` are served with long-lived cache headers
2. `index.html` is served with `no-cache` (so deploys are picked up immediately)
3. API routes (matching `apiPrefix`) pass through to your controllers
4. Any remaining `GET`/`HEAD` request that accepts HTML serves `index.html` —
   your SPA router handles client-side navigation. Anything else (other methods,
   reserved paths, or clients not asking for HTML) falls through untouched.

### Which requests get the fallback

A request falls back to `index.html` when **all** of these hold:

- the method is `GET` or `HEAD`
- the path is not under `apiPrefix` or `exclude`
- the client accepts HTML (`Accept: text/html`)

The `Accept` rule is content negotiation rather than a guess at the path, and
`q` values are honoured — `Accept: text/html;q=0` says HTML is _not_ acceptable
and is treated as such.

It means a route with a dot in it — `/users/john.doe`, `/v1.2/spec` — is served
normally when a browser navigates to it, because browsers send
`Accept: text/html`. A missing `/assets/app.js` fetched with `Accept: */*`
returns **404** instead of an HTML document the browser cannot parse as
JavaScript.

Note the rule is about the header, not the path: a missing dotted path
requested _with_ an HTML `Accept` does receive `index.html`, exactly as a
missing extensionless route does. The SPA router decides what to render.

Prefix matching is segment-aware: `apiPrefix: '/api'` covers `/api` and
`/api/users`, but leaves `/apidocs` to the SPA.

`alwaysFallback: true` skips the `Accept` check entirely — for non-browser
clients that deep-link into SPA routes, whether they omit `Accept` or send a
non-HTML one. The method and reserved-path rules still apply.

## Options

| Option              | Default                                 | Description                                      |
| ------------------- | --------------------------------------- | ------------------------------------------------ |
| `clientDir`         | `'dist/client'`                         | Directory with the built SPA files               |
| `apiPrefix`         | `'/api'`                                | URL prefix for API routes (string or array)      |
| `exclude`           | `[]`                                    | Additional paths to exclude from fallback        |
| `cacheControl`      | `'public, max-age=31536000, immutable'` | Cache header for static assets                   |
| `indexCacheControl` | `'no-cache'`                            | Cache header for index.html                      |
| `alwaysFallback`    | `false`                                 | Serve `index.html` even without an HTML `Accept` |

::: tip Call it without `new`
`SpaAdapter` is a `defineAdapter()` factory, like `ViewAdapter`. Every example
here calls it directly — `SpaAdapter({ ... })`. The pre-factory
`new SpaAdapter({ ... })` form is gone.
:::

## Project Structure

```
my-app/
  src/
    index.ts          ← KickJS server
    modules/          ← API modules
  client/             ← Frontend source (Vue/React/Svelte)
  dist/
    client/           ← Frontend build output
      index.html
      assets/
    server/           ← Server build output
```

## Framework Examples

### Vue (Vite)

```bash
# Build frontend
cd client && npx vite build --outDir ../dist/client
```

```ts
SpaAdapter({ clientDir: 'dist/client' })
```

### React (Vite)

```bash
cd client && npx vite build --outDir ../dist/client
```

```ts
SpaAdapter({ clientDir: 'dist/client' })
```

### Angular

```bash
cd client && npx ng build --output-path ../dist/client
```

```ts
SpaAdapter({ clientDir: 'dist/client' })
```

### Svelte (SvelteKit static)

```bash
cd client && npx vite build --outDir ../dist/client
```

```ts
SpaAdapter({ clientDir: 'dist/client' })
```

## Multiple API Prefixes

```ts
SpaAdapter({
  clientDir: 'dist/client',
  apiPrefix: ['/api', '/graphql', '/_debug'],
  exclude: ['/health', '/ws'],
})
```

## Disable Asset Caching

```ts
SpaAdapter({
  clientDir: 'dist/client',
  cacheControl: false, // no cache headers on assets
})
```
