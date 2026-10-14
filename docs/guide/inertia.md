# Inertia

[Inertia.js](https://inertiajs.com/) lets controllers return pages instead of JSON. A route names a React, Vue or Svelte component and its props; Inertia renders it in the browser and turns later link clicks and form posts into JSON visits, so the app behaves like a SPA without a client-side router or an API layer between them.

`@forinda/kickjs-inertia` is the Inertia v3 adapter. It runs on Express, Fastify and h3, renders pages on the server when you ask it to, and needs `@forinda/kickjs` 10 or later.

## Start from the template

```bash
kick new my-app --template inertia
```

The template is a React app wired with everything on this page: server-side rendering, an error page, validation errors and flash messages through the session, and a `/api/v1` module next to the pages.

```
src/
  index.ts              # bootstrap() with InertiaAdapter
  modules/pages/        # PagesController — the routes that render pages
  client/
    main.tsx            # createInertiaApp — the browser entry
    ssr.tsx             # the server render entry
    Layout.tsx
    pages/              # Home.tsx, Posts/Index.tsx, Error.tsx
vite.config.ts          # kick dev: the API and the pages on one server
vite.client.config.ts   # production builds of the pages
```

`kick dev` serves both through one Vite server. `pnpm build` builds the server, the browser bundle (`dist/client`) and the SSR bundle (`dist/ssr/ssr.js`).

## Add it to an existing app

```bash
pnpm add @forinda/kickjs-inertia @inertiajs/react react react-dom
pnpm add -D @vitejs/plugin-react @types/react @types/react-dom
```

### Wire the adapter

```ts
// src/index.ts
import { bootstrap, session } from '@forinda/kickjs'
import { InertiaAdapter, inertiaErrorHandler, inertiaNotFound } from '@forinda/kickjs-inertia'

export const app = await bootstrap({
  modules,
  // Carries validation errors and flash messages to the next page.
  middlewares: [session({ secret: process.env.SESSION_SECRET! })],
  adapters: [
    InertiaAdapter({
      title: 'My App',
      entry: 'src/client/main.tsx',
      ssr: { entry: 'src/client/ssr.tsx' },
      errorPage: 'Error',
      share: (ctx) => ({ user: ctx.user }),
    }),
  ],
  onError: inertiaErrorHandler(), // failed validation → back to the form
  onNotFound: inertiaNotFound(), // unknown URLs → the Error page
  notFoundFallthrough: false, // same answers under `kick dev` as in production
})
```

| Option      | Default                 | What it does                                                                      |
| ----------- | ----------------------- | --------------------------------------------------------------------------------- |
| `entry`     | `'src/client/main.tsx'` | The file that calls `createInertiaApp`                                            |
| `clientDir` | `'dist/client'`         | Where `vite build` wrote the browser bundle, with `build.manifest: true`          |
| `title`     | `'KickJS'`              | `<title>` of the HTML shell                                                       |
| `head`      | —                       | Tags added to every page's `<head>` — favicon, meta, fonts                        |
| `share`     | —                       | Props every page receives                                                         |
| `errorPage` | —                       | Component rendered for unknown URLs and thrown errors, with `{ status, message }` |
| `ssr`       | —                       | `{ entry, bundle? }` — render pages on the server (below)                         |
| `version`   | manifest hash           | Asset version; a client on another version reloads on its next visit              |
| `template`  | built-in shell          | Replace the HTML shell entirely                                                   |

Per-page titles and meta tags belong in the page, with Inertia's `<Head>` component.

### Mount the pages at the root

Modules mount under `/api/v1` by default. Turn the prefix and version off for the module that renders pages:

```ts
export class PagesModule implements AppModule {
  routes() {
    return { path: '/', prefix: false, version: false, controller: PagesController }
  }
}
```

### The browser entry

```tsx
// src/client/main.tsx
import { createInertiaApp } from '@inertiajs/react'
import { createRoot, hydrateRoot } from 'react-dom/client'

const pages = import.meta.glob('./pages/**/*.tsx', { eager: true })

createInertiaApp({
  resolve: (name) => pages[`./pages/${name}.tsx`] as never,
  setup({ el, App, props }) {
    // Server-rendered pages are hydrated; the rest render from scratch.
    if (el.hasAttribute('data-server-rendered')) hydrateRoot(el, <App {...props} />)
    else createRoot(el).render(<App {...props} />)
  },
})
```

Add `react()` from `@vitejs/plugin-react` to `vite.config.ts`. The server renders the HTML, so Vite has no `index.html` to scan; name the entry for dependency optimization:

```ts
optimizeDeps: {
  entries: ['src/client/main.tsx'],
  include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
},
```

## Pages

A controller method returns `inertia(component, props)`. The component name is the path under `src/client/pages/` without the extension.

```ts
import { Controller, Get, Post, type RequestContext } from '@forinda/kickjs'
import { defer, flash, inertia, redirect } from '@forinda/kickjs-inertia'

@Controller()
export class PagesController {
  @Get('/posts')
  index() {
    return inertia('Posts/Index', {
      posts: () => this.posts.list(), // called only when sent
      stats: defer(() => this.posts.stats()), // loaded after the page renders
    })
  }

  @Post('/posts', { body: createPostSchema })
  async create(ctx: RequestContext) {
    await this.posts.create(ctx.body)
    flash(ctx, { success: 'Post created' })
    return redirect('/posts')
  }
}
```

The first visit gets HTML; every later visit from Inertia gets the same page as JSON.

### Helpers

| Helper                                                                | What it does                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `inertia(component, props, { status, encryptHistory, clearHistory })` | Render a page                                                  |
| `redirect(url)`                                                       | 303 after a submit                                             |
| `back(ctx, fallback?)`                                                | Redirect to the previous page on this site                     |
| `location(url)`                                                       | A full browser visit — another site, or a page outside Inertia |
| `flash(ctx, data)`                                                    | Data for the next page's `flash` prop; needs `session()`       |

### When a prop is sent

| Prop                  | Sent                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| a value or function   | On full visits and on partial reloads that name it; a function is only called when sent                                   |
| `optional(fn)`        | Only when a partial reload names it (`router.reload({ only: [...] })`)                                                    |
| `always(value)`       | Every response, including partial reloads that name other props                                                           |
| `defer(fn, group?)`   | Right after the page renders, one extra request per `group`                                                               |
| `merge(value, mode?)` | Merged into the client's copy on a partial reload — `'append'`, `'prepend'`, `'deep'`; for pagination and infinite scroll |

On the page, wrap a deferred prop in Inertia's `<Deferred>`:

```tsx
<Deferred data="stats" fallback={<p>Loading stats…</p>}>
  <p>Total: {stats?.total}</p>
</Deferred>
```

## Forms and validation

Declare the body schema on the route as usual. With `onError: inertiaErrorHandler()`, a failed check on an Inertia visit redirects back to the form, and the messages arrive as `props.errors` — which `useForm` exposes as `form.errors`:

```tsx
const form = useForm({ title: '' })

<form onSubmit={(e) => { e.preventDefault(); form.post('/posts') }}>
  <input value={form.data.title} onChange={(e) => form.setData('title', e.target.value)} />
  {form.errors.title && <p>{form.errors.title}</p>}
</form>
```

API requests to the same routes still get the usual 422 JSON.

## Errors and unknown URLs

With `errorPage: 'Error'`, `inertiaErrorHandler()` renders thrown errors and `inertiaNotFound()` renders unknown URLs through `src/client/pages/Error.tsx`, which receives `{ status, message }`. In production a 5xx message is replaced with a generic one. API and asset requests keep their JSON answers.

## Server-side rendering

Pass `ssr: { entry }` and give that file a default export that renders a page:

```tsx
// src/client/ssr.tsx
import './app.css' // so dev can link the styles in server-rendered HTML
import { createInertiaApp } from '@inertiajs/react'
import type { Page } from '@inertiajs/core'
import { renderToString } from 'react-dom/server'

const pages = import.meta.glob('./pages/**/*.tsx', { eager: true })

export default (page: Page) =>
  createInertiaApp({
    page,
    render: renderToString,
    resolve: (name) => pages[`./pages/${name}.tsx`] as never,
    setup: ({ App, props }) => <App {...props} />,
  })
```

In dev the entry is loaded through Vite. In production the adapter loads the built bundle — `dist/ssr/ssr.js` by default, or `ssr.bundle`. A render that throws falls back to client rendering for that request.

## Building for production

The pages need their own Vite config, separate from the server's:

```ts
// vite.client.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ isSsrBuild }) => ({
  envDir: false, // the server's .env would make these development builds
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  build: isSsrBuild
    ? { outDir: 'dist/ssr' }
    : { outDir: 'dist/client', manifest: true, rollupOptions: { input: 'src/client/main.tsx' } },
}))
```

```json
{
  "scripts": {
    "build": "kick build && vite build --config vite.client.config.ts && vite build --config vite.client.config.ts --ssr src/client/ssr.tsx"
  }
}
```

The adapter reads `dist/client/.vite/manifest.json` for the script and style tags, serves `dist/client/assets/` and `public/`, and versions assets by a hash of the manifest.

## What the adapter handles

- The protocol: `X-Inertia` JSON responses, `Vary`, partial reloads, the asset version check (409), and 302 → 303 after PUT, PATCH and DELETE.
- Assets: Vite's dev server under `kick dev`; the build manifest, `assets/` and `public/` in production.
- Server-side rendering, with a fallback to client rendering.
- Validation errors and flash data through the session.

## See also

- [Wiring Your Own Frontend](./fullstack-frontend.md) — a separate SPA calling the API through the typed client
- [Validation](./validation.md)
- [Sessions](./sessions.md)
