# @forinda/kickjs-inertia

[Inertia.js](https://inertiajs.com) adapter for KickJS: controllers return pages, and React, Vue or Svelte render them — no client-side router or API layer to maintain.

The [Inertia guide](../guide/inertia.md) walks through setup, pages, forms, SSR and deployment. This page lists the exports.

## Install

```bash
pnpm add @forinda/kickjs-inertia
```

Peer dependency: `@forinda/kickjs` (`>=10.0.0`). Add the Inertia client for your framework (e.g. `@inertiajs/react`) — see [Add it to an existing app](../guide/inertia.md#add-it-to-an-existing-app).

## Entry points

| Import path               | Exports                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@forinda/kickjs-inertia` | `InertiaAdapter`, `inertia`, `redirect`, `back`, `location`, `flash`, `buildPage`, `isInertiaRequest`, `isPageRequest`, `errorPage`, prop helpers (`optional`, `always`, `defer`, `merge`, `once`, `scroll`), `inertiaErrorHandler`, `inertiaNotFound`, `precognitive`, `defaultTemplate`, `pageBody`, `h`, `sitemap`, `robots`, and their types |

## InertiaAdapter

Wires the protocol into the app: lets `inertia()` render (HTML shell, asset tags, version), answers a stale Inertia GET with 409 so the client reloads, turns a 302 after PUT / PATCH / DELETE into 303, adds `Vary: X-Inertia`, and in production serves the built client's `assets/`.

```typescript
const InertiaAdapter: AdapterFactory<InertiaAdapterOptions>
```

```ts
import { bootstrap, session } from '@forinda/kickjs'
import { InertiaAdapter, inertiaErrorHandler, inertiaNotFound } from '@forinda/kickjs-inertia'

bootstrap({
  modules,
  middlewares: [session({ secret: process.env.SESSION_SECRET!, store: 'cookie' })],
  adapters: [
    InertiaAdapter({
      title: 'My App',
      share: (ctx) => ({ user: ctx.get('user') ?? null }),
      errorPage: 'Error',
    }),
  ],
  onError: inertiaErrorHandler(),
  onNotFound: inertiaNotFound(),
})
```

### InertiaAdapterOptions

| Field       | Type                                                                                   | Default                                  | Description                                                                                                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry`     | `string`                                                                               | `'src/client/main.tsx'`                  | Client entry (the file calling `createInertiaApp`), relative to the project root. Served by Vite in dev, looked up in the build manifest in production.                                                    |
| `clientDir` | `string`                                                                               | `'dist/client'`                          | Where `vite build` wrote the client (with `build.manifest: true`). Resolved against `KICK_APP_ROOT` when set, else the working directory.                                                                  |
| `version`   | `string \| (() => string)`                                                             | manifest hash in production, none in dev | Asset version. A client on another version reloads on its next visit.                                                                                                                                      |
| `share`     | `(ctx: RequestContext) => Record<string, unknown> \| Promise<Record<string, unknown>>` | —                                        | Props every page gets.                                                                                                                                                                                     |
| `title`     | `string`                                                                               | `'KickJS'`                               | `<title>` of the default HTML shell.                                                                                                                                                                       |
| `head`      | `string`                                                                               | —                                        | Tags added to every page's `<head>` (favicon, fonts).                                                                                                                                                      |
| `meta`      | `MetaDefaults`                                                                         | —                                        | Meta every page starts from; a page's `meta` is merged over it. `titleTemplate` (`'%s · App'`) wraps a page's title.                                                                                       |
| `baseUrl`   | `string`                                                                               | —                                        | Absolute http(s) URL of the site. Makes `canonical` / `og:url` / `og:image` / `twitter:image` paths absolute; a 2xx page without a `canonical` gets `baseUrl` + its path. Never read from the Host header. |
| `template`  | `HtmlTemplate`                                                                         | `defaultTemplate(title)`                 | Replace the HTML shell entirely.                                                                                                                                                                           |
| `errorPage` | `string`                                                                               | —                                        | Page component for errors and unknown URLs; receives `{ status, message }`. Used by `inertiaErrorHandler()` and `inertiaNotFound()`.                                                                       |
| `ssr`       | `{ entry: string; bundle?: string }`                                                   | —                                        | Server-side rendering. `entry` is loaded through Vite in dev; production loads `bundle` (default `'dist/ssr/ssr.js'`). A render that throws falls back to client rendering.                                |

```typescript
interface SsrResult {
  head: string[]
  body: string
}
```

The SSR entry's default export is `(page: Page) => Promise<SsrResult>`.

## Responses

All of these return a `Respondable` — return it from a handler.

### inertia

Render a page: the HTML shell on a first visit, the page object as JSON on an Inertia visit (`X-Inertia: true`). Also remembers the page URL in the session for `back()`.

```typescript
function inertia(
  component: string,
  props?: Record<string, unknown>,
  options?: PageOptions,
): Respondable

interface PageOptions {
  encryptHistory?: boolean // encrypt this page's history entry
  clearHistory?: boolean // wipe the browser's Inertia history (e.g. after logout)
  status?: number // default 200
  meta?: PageMeta // title, description, social tags — see below
}

interface PageMeta {
  title?: string
  lang?: string // <html lang>, default 'en'
  description?: string
  canonical?: string // a path (made absolute with baseUrl) or a full URL
  robots?: string // 'noindex, nofollow'
  og?: Record<string, string> // without the prefix: { type: 'article', image: '/cover.png' }
  twitter?: Record<string, string> // { card: 'summary_large_image' }
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
  head?: HeadTag[] // other <meta> / <link>, built with h()
}

interface MetaDefaults extends PageMeta {
  titleTemplate?: string // '%s · My App'
}
```

The resolved meta (defaults merged, template applied, URLs absolute) is the page's `meta` field on every response, and is rendered — escaped — into the first-visit `<head>` as tags with `data-inertia="<key>"` (`description`, `robots`, `canonical`, `og:<key>`, `twitter:<key>`, `json-ld`), the same keys a `<Head>` tag with that `head-key` gets. A tag a server-rendered `<Head>` sets is left out. `og:title`, `og:description` and `og:url` default to the title, description and canonical URL. `errorPage()` responses carry `robots: 'noindex'`. The default canonical is the path without its query string or trailing slash.

### h

A `<meta>` or `<link>` for `meta.head`. Throws on another tag, an `on*` attribute, or a tag with nothing to key it by (a `meta` without `name` / `property` / `http-equiv`, a `link` without `rel`). A page's tag replaces a default with the same key; an `alternate` link's path is made absolute with `baseUrl`.

```typescript
function h(tag: 'meta' | 'link', attrs: Record<string, string>): HeadTag

interface HeadTag {
  tag: 'meta' | 'link'
  attrs: Record<string, string>
  key: string // 'meta:theme-color', 'link:alternate:fr'
}
```

```ts
@Get('/users')
async index() {
  return inertia('Users/Index', { users: await this.users.list() })
}
```

### redirect

Redirect after a form submit: 302 for GET, 303 otherwise, and saves the session first so flashed data arrives. A URL with a `#fragment` is sent to an Inertia visit as 409 + `X-Inertia-Redirect`.

```typescript
function redirect(url: string, options?: RedirectOptions): Respondable

interface RedirectOptions {
  preserveFragment?: boolean // keep the request URL's #fragment; needs session()
}
```

### back

Redirect to the previous page: the last page this session rendered, else a same-origin `Referer`, else `fallback`. Never another site.

```typescript
function back(ctx: RequestContext, fallback?: string, options?: RedirectOptions): Respondable
```

`fallback` defaults to `'/'`.

### location

A full browser visit outside Inertia (another site, a non-Inertia page). An Inertia request gets 409 + `X-Inertia-Location`; others a plain redirect.

```typescript
function location(url: string): Respondable
```

### errorPage

The given component as a response with `{ status, message }` props. A 5xx message is replaced in production.

```typescript
function errorPage(component: string, status: number, error?: unknown): Respondable
```

### flash

Flash data for the next page, sent as the page's top-level `flash`. Throws without the `session()` middleware.

```typescript
function flash(ctx: RequestContext, data: Record<string, unknown>): void
```

```ts
@Post('/users')
async create(ctx: RequestContext) {
  await this.users.create(ctx.body)
  flash(ctx, { success: 'User created' })
  return redirect('/users')
}
```

## Prop helpers

Wrap a prop to change when it is sent. A plain value or function is sent on every full visit and on partial reloads that ask for it; a function is only called when the prop is sent.

```typescript
type Resolver<T> = T | (() => T | Promise<T>)

function optional<T>(value: () => T | Promise<T>): InertiaProp<T>
function always<T>(value: Resolver<T>): InertiaProp<T>
function defer<T>(value: () => T | Promise<T>, group?: string): InertiaProp<T>
function merge<T>(
  value: Resolver<T>,
  mode?: 'append' | 'prepend' | 'deep',
  options?: { matchOn?: string | string[] },
): InertiaProp<T>
function once<T>(value: Resolver<T>, options?: { key?: string; ttl?: number }): InertiaProp<T>
function scroll<T>(
  value: Resolver<T>,
  options?: {
    pageName?: string
    wrapper?: string
    matchOn?: string | string[]
    meta?: (value: T) => ScrollMeta
  },
): InertiaProp<T>
```

| Helper     | Sent                                                                                              | Defaults                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `optional` | Only when a partial reload names it.                                                              | —                                                                                                |
| `always`   | On every response, including partial reloads that didn't name it.                                 | —                                                                                                |
| `defer`    | Left out of the first response; fetched right after render, one request per `group`.              | `group: 'default'`                                                                               |
| `merge`    | Merged into the client's current value on a partial reload (paginated lists).                     | `mode: 'append'`                                                                                 |
| `once`     | Resolved once and cached by the client until `ttl` (ms) runs out; pages sharing a `key` share it. | —                                                                                                |
| `scroll`   | One page of an infinite list for `<InfiniteScroll>`; the client asks for pages with `?page=N`.    | `pageName: 'page'`, `wrapper: 'data'`, `meta` reads `{ data, meta: { page, hasNext, hasPrev } }` |

```typescript
interface ScrollMeta {
  currentPage: number | string | null
  nextPage: number | string | null
  previousPage: number | string | null
}
```

```ts
return inertia('Dashboard', {
  stats: defer(() => this.stats.compute()),
  plans: once(() => this.plans.all(), { ttl: 3_600_000 }),
  feed: scroll(() => this.posts.paginate(ctx)),
})
```

## Errors and validation

### inertiaErrorHandler

Pass to `bootstrap({ onError })`. A validation 422 on a Precognition request answers with the errors of the requested fields; on an Inertia visit it goes back to the form with the errors (needs `session()`). Any other error on a page request renders `errorPage` when configured. Everything else goes to `fallback`.

```typescript
function inertiaErrorHandler(fallback?: ErrorHandler): ErrorHandler
```

`fallback` defaults to the framework's `errorHandler()`.

### inertiaNotFound

Pass to `bootstrap({ onNotFound })`. A browser or Inertia request for an unknown URL gets `errorPage` with 404; other requests fall through to the built-in 404 / 405.

```typescript
function inertiaNotFound(): NotFoundHandler
```

### precognitive

Middleware for live validation with `useForm().validate()` (Laravel Precognition). A precognitive request runs the route's validation and stops before the handler.

```typescript
const precognitive: MiddlewareHandler<RequestContext>
```

```ts
@Post('/users', { body: createUserSchema })
@Middleware(precognitive)
create(ctx: RequestContext) { … }
```

## SEO responses

### sitemap

`/sitemap.xml` as `application/xml`. Each `loc` is XML-escaped; a path is made absolute with `baseUrl`.

```typescript
function sitemap(entries: Iterable<SitemapEntry>, options?: { baseUrl?: string }): Respondable

interface SitemapEntry {
  loc: string
  lastmod?: Date | string
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'
  priority?: number // 0.0 – 1.0
}
```

### robots

`/robots.txt` as `text/plain`. With no `allow` / `disallow`, everything is allowed. Line breaks in values are dropped.

```typescript
function robots(options?: RobotsOptions): Respondable

interface RobotsOptions {
  userAgent?: string // default '*'
  allow?: string[]
  disallow?: string[]
  sitemap?: string | string[] // a path is made absolute with baseUrl
  baseUrl?: string
}
```

```ts
@Get('/robots.txt')
robots() {
  return robots({ disallow: ['/admin'], sitemap: '/sitemap.xml', baseUrl: getEnv('APP_URL') })
}
```

## Lower-level helpers

### buildPage

Build the page object (shared props, partial reloads, deferred / merge / once / scroll metadata) without sending it.

```typescript
function buildPage(
  ctx: RequestContext,
  component: string,
  props: Record<string, unknown>,
  options?: PageOptions,
): Promise<Page>
```

### isInertiaRequest / isPageRequest

```typescript
function isInertiaRequest(ctx: RequestContext): boolean // X-Inertia: true
function isPageRequest(headers: Record<string, string | string[] | undefined>): boolean // Inertia visit or Accept: text/html
```

### Page

The page object the client renders.

```typescript
interface Page {
  component: string
  props: Record<string, unknown> & { errors: Record<string, unknown> }
  url: string
  version: string | null
  flash: Record<string, unknown>
  sharedProps?: string[]
  deferredProps?: Record<string, string[]>
  mergeProps?: string[]
  prependProps?: string[]
  deepMergeProps?: string[]
  matchPropsOn?: string[]
  scrollProps?: Record<string, ScrollMeta & { pageName: string; reset: boolean }>
  onceProps?: Record<string, { prop: string; expiresAt?: number }>
  encryptHistory?: boolean
  clearHistory?: boolean
  preserveFragment?: boolean
  meta?: PageMeta
}
```

## HTML shell

### defaultTemplate / pageBody

```typescript
type HtmlTemplate = (parts: HtmlParts) => string

interface HtmlParts {
  head: string // script and style tags for the client entry, then the page's meta tags
  body: string // page data and mount element
  page: Page
}

const defaultTemplate: (title: string) => HtmlTemplate
function pageBody(page: Page, id?: string): string
```

`pageBody` renders the page as `<script data-page="app" type="application/json">` followed by `<div id="app">` (`id` defaults to `'app'`), escaping `<` and `/` so a prop can't close the tag.

```ts
InertiaAdapter({
  template: ({ head, body }) => `<!doctype html>
<html lang="en" class="dark">
  <head>${head}</head>
  <body>${body}</body>
</html>`,
})
```

## See also

- [Inertia guide](../guide/inertia.md)
- [Full-stack frontend](../guide/fullstack-frontend.md)
- [Sessions](../guide/sessions.md)
