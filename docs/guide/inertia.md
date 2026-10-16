# Inertia

[Inertia.js](https://inertiajs.com/) lets controllers return pages instead of JSON. A route names a React, Vue or Svelte component and its props; Inertia renders it in the browser and turns later link clicks and form posts into JSON visits, so the app behaves like a SPA without a client-side router or an API layer between them.

::: tip Example
[`inertia-app`](https://github.com/forinda/kickjs-examples-archive/tree/main/inertia-app): an Inertia (React, SSR) notes app with form errors, flash toasts and deferred props. More in [Examples](../examples/index.md).
:::

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

`kick dev` serves both through one Vite server. Saving a page or a stylesheet updates the open browser tab in place — React Fast Refresh keeps component state and form input — and saving server code reloads the app. `pnpm build` builds the server, the browser bundle (`dist/client`) and the SSR bundle (`dist/ssr/ssr.js`).

## Add it to an existing app

```bash
pnpm add @forinda/kickjs-inertia @inertiajs/react react react-dom
pnpm add -D @vitejs/plugin-react @types/react @types/react-dom
```

### Wire the adapter

```ts
// src/index.ts
import './config' // the env schema, which declares SESSION_SECRET
import { bootstrap, getEnv, session } from '@forinda/kickjs'
import { InertiaAdapter, inertiaErrorHandler, inertiaNotFound } from '@forinda/kickjs-inertia'

export const app = await bootstrap({
  modules,
  // Carries validation errors and flash messages to the next page.
  middlewares: [session({ secret: getEnv('SESSION_SECRET'), store: 'cookie' })],
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
| `title`     | `'KickJS'`              | `<title>` of the HTML shell, replaced by a page's `<Head>` title                  |
| `head`      | —                       | Tags added to every page's `<head>` — favicon, fonts                              |
| `meta`      | —                       | Meta every page starts from, with a `titleTemplate` ([SEO](#seo))                 |
| `baseUrl`   | —                       | The site's public URL, for canonical and absolute URLs ([SEO](#seo))              |
| `share`     | —                       | Props every page receives                                                         |
| `errorPage` | —                       | Component rendered for unknown URLs and thrown errors, with `{ status, message }` |
| `ssr`       | —                       | `{ entry, bundle? }` — render pages on the server (below)                         |
| `version`   | manifest hash           | Asset version; a client on another version reloads on its next visit              |
| `template`  | built-in shell          | Replace the HTML shell entirely                                                   |

Per-page titles and meta tags: pass `meta` to `inertia()`, or use Inertia's `<Head>` in the page — see [SEO](#seo).

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

### The dev server

`kick dev` compiles the server with swc, which emits the decorator metadata KickJS needs. The pages are better compiled by Vite's own oxc, because that is where `@vitejs/plugin-react` adds Fast Refresh — swc's plugin switches oxc off for every file, so give each its half:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import swc from 'unplugin-swc'
import react from '@vitejs/plugin-react'
import { kickjsVitePlugin } from '@forinda/kickjs-vite'

const client = /src\/client\/.+\.[jt]sx?$/

export default defineConfig({
  oxc: { include: client },
  plugins: [
    // Drop swc's config hook, which would turn oxc off for the pages too.
    { ...swc.vite({ exclude: [/node_modules/, client] }), config: undefined },
    react(),
    kickjsVitePlugin({ entry: 'src/index.ts' }),
  ],
  // The server renders the HTML, so Vite has no index.html to scan.
  optimizeDeps: {
    entries: ['src/client/main.tsx'],
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
})
```

Without the split, page edits still show up, but as a full page reload that loses component state.

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
| `redirect(url, { preserveFragment })`                                 | 303 after a submit                                             |
| `back(ctx, fallback?, { preserveFragment })`                          | Redirect to the previous page on this site                     |
| `location(url)`                                                       | A full browser visit — another site, or a page outside Inertia |
| `flash(ctx, data)`                                                    | Data for the next page's `flash` prop; needs `session()`       |

### When a prop is sent

| Prop                               | Sent                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| a value or function                | On full visits and on partial reloads that name it; a function is only called when sent |
| `optional(fn)`                     | Only when a partial reload names it (`router.reload({ only: [...] })`)                  |
| `always(value)`                    | Every response, including partial reloads that name other props                         |
| `defer(fn, group?)`                | Right after the page renders, one extra request per `group`                             |
| `merge(value, mode?, { matchOn })` | Merged into the client's copy on a partial reload — `'append'`, `'prepend'`, `'deep'`   |
| `once(fn, { key?, ttl? })`         | Once; the client keeps it and later visits skip it (below)                              |
| `scroll(fn, options?)`             | One page of an infinite list (below)                                                    |

On the page, wrap a deferred prop in Inertia's `<Deferred>`:

```tsx
<Deferred data="stats" fallback={<p>Loading stats…</p>}>
  <p>Total: {stats?.total}</p>
</Deferred>
```

### Data the client keeps

`once()` sends a prop on the first visit only. The client caches it and tells the server which props it holds, so later visits — to this page or any page using the same `key` — skip resolving it:

```ts
return inertia('Billing', {
  plans: once(() => this.plans.list(), { ttl: 60 * 60_000 }), // refetched after an hour
})
```

A partial reload that names the prop (`router.reload({ only: ['plans'] })`) always gets a fresh value.

### Merging by id

By default merged rows are appended. `matchOn` names a field that identifies a row, so a row the client already has is replaced in place instead of added again:

```ts
users: merge(() => this.users.page(n), 'append', { matchOn: 'id' })
```

### Infinite scroll

`scroll()` serves Inertia's `<InfiniteScroll>`. Return one page as `{ data, meta: { page, hasNext, hasPrev } }` — the `PaginatedResponse` shape — and the client asks for the next or previous page with `?page=N` as the user scrolls:

```ts
@Get('/posts')
index(ctx: RequestContext) {
  const page = Number(ctx.query.page ?? 1)
  return inertia('Posts/Index', {
    posts: scroll(() => this.posts.page(page), { matchOn: 'id' }),
  })
}
```

```tsx
<InfiniteScroll data="posts">
  {posts.data.map((post) => (
    <PostRow key={post.id} post={post} />
  ))}
</InfiniteScroll>
```

| Option     | Default  | What it does                                                             |
| ---------- | -------- | ------------------------------------------------------------------------ |
| `pageName` | `'page'` | The query parameter the client sends                                     |
| `wrapper`  | `'data'` | The key holding the rows                                                 |
| `matchOn`  | —        | A row field that identifies it, as with `merge`                          |
| `meta`     | —        | `(value) => ({ currentPage, nextPage, previousPage })` for another shape |

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

### Live validation

Inertia's `useForm` can check fields as the user fills them in, before the form is submitted, using the Precognition protocol. Put `precognitive` on the route; the route's schema runs, and the handler doesn't:

```ts
import { precognitive } from '@forinda/kickjs-inertia'

@Post('/users', { body: createUserSchema })
@Middleware(precognitive)
create(ctx: RequestContext) {
  // runs only for the real submit
}
```

```tsx
const form = useForm('post', '/users', { name: '', email: '' })

<input
  value={form.data.email}
  onChange={(e) => form.setData('email', e.target.value)}
  onBlur={() => form.validate('email')}
/>
{form.errors.email && <p>{form.errors.email}</p>}
```

Each check reports only the fields the form has validated so far, so the user isn't shown errors for fields they haven't reached. `inertiaErrorHandler()` must be the app's `onError`.

### Keeping the `#fragment`

A redirect to a URL with a fragment (`redirect('/posts/1#comments')`) keeps it.

`preserveFragment` keeps the fragment of the URL the form was **submitted to**, so the redirect can stay generic. Put the fragment in the submit URL — the browser leaves it out of the request, and the Inertia client puts it back on the page it lands on:

```tsx
form.post('/posts/1/comments#comments')
```

```ts
@Post('/posts/:id/comments')
comment(ctx: RequestContext) {
  // …save the comment
  return back(ctx, '/', { preserveFragment: true }) // lands on /posts/1#comments
}
```

The fragment of the page the form sits on is not used; a form on `/posts/1#comments` that posts to `/posts/1/comments` lands on `/posts/1`.

## Errors and unknown URLs

With `errorPage: 'Error'`, `inertiaErrorHandler()` renders thrown errors and `inertiaNotFound()` renders unknown URLs through `src/client/pages/Error.tsx`, which receives `{ status, message }`. In production a 5xx message is replaced with a generic one. API and asset requests keep their JSON answers.

## SEO

Search engines and link previews read the HTML of the first visit. With [server-side rendering](#server-side-rendering) that HTML holds the page's content; without it, only the shell — so a site that needs to be found should render on the server, as the template does.

### Meta from the controller

Pass `meta` to `inertia()`. It is rendered into the first-visit HTML `<head>` and sent as the page's `meta` on every visit:

```ts
@Get('/notes/:id')
async show(ctx: RequestContext) {
  const note = await this.notes.find(ctx.params.id)
  return inertia('Notes/Show', { note }, {
    meta: {
      title: note.title,
      description: note.summary,
      og: { type: 'article', image: note.coverPath }, // og:type, og:image
      twitter: { card: 'summary_large_image' },
      jsonLd: { '@context': 'https://schema.org', '@type': 'Article', headline: note.title },
    },
  })
}
```

Every value is escaped; JSON-LD is written into `<script type="application/ld+json">` with `<` escaped, so a value can't close the tag. `og:title`, `og:description` and `og:url` default to the title, description and canonical URL.

On a client-side visit nothing re-renders the `<head>` by itself. The template's `src/client/Seo.tsx`, rendered by `Layout`, reads `usePage().meta` and renders Inertia's `<Head>` with `head-key`s that match the tags the adapter wrote, so the browser's title and tags follow the page instead of piling up.

### Server meta and `<Head>`

A page can still use `<Head>` itself. When a server-rendered `<Head>` sets a tag — the `<title>`, a `<meta>` with the same `name` or `property`, the canonical `<link>`, JSON-LD — the adapter leaves out its own copy, so the first HTML never has two. Pick one source per tag for client-side visits too.

### Defaults and the title template

```ts
InertiaAdapter({
  baseUrl: getEnv('APP_URL'),
  meta: {
    title: 'My App', // pages without a title
    titleTemplate: '%s · My App', // wraps a page's title
    description: 'Notes for teams.',
    og: { site_name: 'My App', image: '/og.png' },
  },
})
```

A page's `meta` is merged over the defaults (`og` and `twitter` key by key; `jsonLd` replaces). The template applies to a page's title, not to the default `title`.

### Canonical URLs come from `baseUrl`

`baseUrl` makes a path absolute: `canonical`, `og:image`, `og:url`, `twitter:image`. A successful page without a `canonical` gets `baseUrl` plus its path, without the query string. The request's `Host` header is never used — the client sends it, and a spoofed one would otherwise end up in your canonical links. The template reads `baseUrl` from `APP_URL`, which must be set outside `development` and `test`.

### Keep indexable content in plain props

[Deferred](#when-a-prop-is-sent) and optional props are not in the first response, so a crawler doesn't see them. Put what should be indexed in plain props; defer only what search engines don't need (counts, recommendations, the sidebar).

### Status codes

A missing record should answer 404, not a 200 page that says "not found" — throw `HttpException` (or return `errorPage('Error', 404)`) and the [error page](#errors-and-unknown-urls) renders with the right status. Error pages are sent with `robots: noindex` and no canonical link.

### Sitemap and robots.txt

Answer both from an ordinary controller, on any runtime:

```ts
import { Controller, Get, getEnv } from '@forinda/kickjs'
import { robots, sitemap } from '@forinda/kickjs-inertia'

@Controller()
export class SeoController {
  @Get('/sitemap.xml')
  async sitemap() {
    const posts = await this.posts.list()
    return sitemap(
      [
        { loc: '/', priority: 1 },
        ...posts.map((p) => ({ loc: `/posts/${p.id}`, lastmod: p.updatedAt })),
      ],
      { baseUrl: getEnv('APP_URL') },
    )
  }

  @Get('/robots.txt')
  robots() {
    return robots({ disallow: ['/admin'], sitemap: '/sitemap.xml', baseUrl: getEnv('APP_URL') })
  }
}
```

`sitemap()` sends `application/xml` with every `loc` made absolute and XML-escaped; `lastmod` takes a `Date` or a date string, plus optional `changefreq` and `priority`. Mount the module at the root (`prefix: false, version: false`), and don't also keep a `public/robots.txt` — the template answers both from `src/modules/seo`.

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

// Production builds only — the server's .env sets NODE_ENV=development.
process.env.NODE_ENV = 'production'

export default defineConfig(({ isSsrBuild }) => ({
  envDir: false,
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  // The render bundle carries React: a serverless function has no node_modules.
  ssr: { noExternal: true },
  define: isSsrBuild ? { 'process.env.NODE_ENV': JSON.stringify('production') } : {},
  build: isSsrBuild
    ? { outDir: 'dist/ssr', copyPublicDir: false }
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

The adapter reads `dist/client/.vite/manifest.json` for the script and style tags, serves `dist/client/assets/` and `public/`, and versions assets by a hash of the manifest. Under `NODE_ENV` development or test a missing manifest is tolerated — pages render without their scripts and a warning says so, which is what lets tests run before the client is built. Anywhere else, including an unset `NODE_ENV`, it stops the app at startup.

## Testing

`createTestApp` boots the pages without `kick dev` or a client build. Pin `version` so an `X-Inertia` request isn't answered 409 once a build exists, and send the same value:

```ts
const { app } = await createTestApp({
  modules: [PagesModule()],
  adapters: [InertiaAdapter({ version: 'test' })],
})
const res = await request(app.handle.bind(app))
  .get('/posts')
  .set({ 'X-Inertia': 'true', 'X-Inertia-Version': 'test' })
expect(res.body.component).toBe('Posts/Index')
```

## Deploying

An Inertia app deploys like any KickJS app — see [Deploying](./deployment.md):

- **A Node host or Docker**: `pnpm build`, then `node dist/index.js`. The project's `Dockerfile` builds the server, the pages and the render bundle into one image.
- **Netlify or Vercel**: `pnpm run build:netlify` / `pnpm run build:vercel`. The platform serves `dist/client` (the built pages' scripts, styles and `public/` files), the function renders every page, and the asset manifest and render bundle are packaged with it.

Validation errors, flash messages and the "back" URL travel in the session. With more than one instance — several containers, or functions — use the cookie store, as the template does, so the request after a redirect finds them wherever it lands:

```ts
session({ secret: getEnv('SESSION_SECRET'), store: 'cookie' })
```

Set `SESSION_SECRET` to a long random string on every target. The template's env schema accepts its fixed development-only value only when `NODE_ENV` is `development` (`kick dev`) or `test` (Vitest). Anywhere else, including a deploy that leaves `NODE_ENV` unset, the app refuses to boot until a real secret is set. `APP_URL` works the same way: set it to the site's public URL (canonical links and the sitemap are built from it); the `http://localhost:3000` default is only accepted under `development` or `test`.

Netlify and Vercel functions have no persistent disk, and a container's filesystem is lost when it is replaced: keep a SQLite database file on a mounted volume (`docker run -v data:/app/data`, pointing the app at `/app/data/…`), or use a hosted database.

## What the adapter handles

- The protocol: `X-Inertia` JSON responses, `Vary`, partial reloads, once props, infinite scroll, the asset version check (409), redirects that keep a `#fragment`, Precognition, and 302 → 303 after PUT, PATCH and DELETE.
- Assets: Vite's dev server under `kick dev`; the build manifest, `assets/` and `public/` in production.
- Server-side rendering, with a fallback to client rendering.
- Validation errors and flash data through the session.

## See also

- [Wiring Your Own Frontend](./fullstack-frontend.md) — a separate SPA calling the API through the typed client
- [Validation](./validation.md)
- [Sessions](./sessions.md)
