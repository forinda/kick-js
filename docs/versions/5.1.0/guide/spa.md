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

## How It Works

1. Static files in `clientDir` are served with long-lived cache headers
2. `index.html` is served with `no-cache` (so deploys are picked up immediately)
3. API routes (matching `apiPrefix`) pass through to your controllers
4. Everything else serves `index.html` — your SPA router handles client-side navigation

## Options

| Option | Default | Description |
|---|---|---|
| `clientDir` | `'dist/client'` | Directory with the built SPA files |
| `apiPrefix` | `'/api'` | URL prefix for API routes (string or array) |
| `exclude` | `[]` | Additional paths to exclude from fallback |
| `cacheControl` | `'public, max-age=31536000, immutable'` | Cache header for static assets |
| `indexCacheControl` | `'no-cache'` | Cache header for index.html |

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
