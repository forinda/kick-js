# @forinda/kickjs-inertia

## 0.4.0

### Minor Changes

- [#983](https://github.com/forinda/kick-js/pull/983) [`1cac536`](https://github.com/forinda/kick-js/commit/1cac5365a30a0264a29663dfe99e8f80b218605e) Thanks [@forinda](https://github.com/forinda)! - SEO additions:
  
  - **`h()` and `meta.head`:** any other `<meta>` or `<link>` for a page, such as hreflang alternates, `theme-color` or preloads. A tag is keyed by what it sets, so a page's tag replaces the default with the same key.
  - **`meta.lang`:** sets `<html lang>`. The default is still `'en'`.
  - **Fixes:**
    - The default canonical drops a trailing slash, so `/posts/` and `/posts` share one canonical URL.
    - The title and meta tags now come before the asset tags in `<head>`.
    - Content-hashed build files are sent with `Cache-Control: public, max-age=31536000, immutable`.

## 0.3.0

### Minor Changes

- [#921](https://github.com/forinda/kick-js/pull/921) [`7354fc9`](https://github.com/forinda/kick-js/commit/7354fc9b798f286094b23d8b923c18d7427bb107) Thanks [@forinda](https://github.com/forinda)! - SEO for Inertia apps.
  
  - `inertia(component, props, { meta })` sets a page's title, description, canonical URL, robots, Open Graph / Twitter tags and JSON-LD. It is rendered, escaped, into the first-visit `<head>` and sent as the page's `meta` on every visit; a tag a server-rendered `<Head>` sets wins over the same one from `meta`.
  - `InertiaAdapter({ meta, baseUrl })`: meta defaults with a `titleTemplate`, and the site URL that canonical and image URLs are made absolute with — never the request's Host header. Error pages are sent `noindex`.
  - `sitemap(entries)` and `robots(options)` answer `/sitemap.xml` and `/robots.txt` from a controller, on every runtime.
  - `kick new --template inertia`: an `APP_URL` env entry (localhost default only under `NODE_ENV` development or test), a `Seo` component that keeps the browser's `<head>` in sync on client-side visits, meta on the pages, and `/sitemap.xml` + `/robots.txt` routes in `src/modules/seo` (replacing `public/robots.txt`).

### Patch Changes

- [#928](https://github.com/forinda/kick-js/pull/928) [`87bbe99`](https://github.com/forinda/kick-js/commit/87bbe99c595724572675ac9d8975c459534939f4) Thanks [@forinda](https://github.com/forinda)! - The error page hides a 5xx exception's message unless `NODE_ENV` is `development` or `test`. It used to hide it only when `NODE_ENV` was `production`, so a deploy that forgot to set it showed the raw exception text to visitors. Migration: set `NODE_ENV=development` if you relied on seeing the message with it unset.

- [#920](https://github.com/forinda/kick-js/pull/920) [`06e5768`](https://github.com/forinda/kick-js/commit/06e5768f5224fe12442ca55944c8cc8776663380) Thanks [@forinda](https://github.com/forinda)! - Inertia template and adapter fixes:
  
  - `InertiaAdapter` renders without a client build under `NODE_ENV` development or test (no asset tags, no asset version, one warning), so `createTestApp` works on a fresh clone; production — and an unset `NODE_ENV` — still fails at startup without the manifest.
  - `InertiaAdapterOptions` marks the defaulted `entry`, `clientDir` and `title` optional.
  - The default HTML shell leaves out its `<title>` when the head already has one (a server-rendered `<Head>`), so the page has a single title.
  - `kick new --template inertia` declares `SESSION_SECRET` in the env schema — required in production, a dev-only default elsewhere — and reads it with `getEnv`, instead of throwing in `src/index.ts` when it is unset. The project ships a pages test that runs before the client is built.
  - `kick new --yes` without `--pm` uses the package manager that launched it (`pnpm dlx`, `yarn dlx`, `bunx`) when no project config, `packageManager` field or lockfile decides.
  - The generated Dockerfile prepares a writable `/app/data` for a volume (a SQLite file, uploads) and says so.

## 0.2.0

### Minor Changes

- [#860](https://github.com/forinda/kick-js/pull/860) [`160f99b`](https://github.com/forinda/kick-js/commit/160f99b6f75d6ea827fbd1adeaed26abdbc8e804) Thanks [@forinda](https://github.com/forinda)! - More of the Inertia v3 protocol:
  
  - `once(fn, { key, ttl })` — a prop the client keeps; later visits skip resolving it.
  - `scroll(fn, options)` — a page of an `<InfiniteScroll>` list. It reads `{ data, meta: { page, hasNext, hasPrev } }` by default.
  - `merge(value, mode, { matchOn })` — merged rows replace the ones with the same id instead of being added again.
  - `redirect()` to a URL with a `#fragment` keeps the fragment on an Inertia visit, and `redirect(url, { preserveFragment: true })` / `back(ctx, fallback, { preserveFragment: true })` keep the fragment of the URL the form was submitted to.
  - `@Middleware(precognitive)` — live validation for `useForm().validate()`. The route's schema runs and the handler doesn't; `inertiaErrorHandler()` reports only the fields the form asked about.

### Patch Changes

- [#861](https://github.com/forinda/kick-js/pull/861) [`f2d07ff`](https://github.com/forinda/kick-js/commit/f2d07ffc2ec19f1913bf66a52b65a7a21a83837c) Thanks [@forinda](https://github.com/forinda)! - The adapter finds its build output (`dist/client`, the SSR bundle) under `KICK_APP_ROOT` when that is set. The functions `kick build:netlify` / `kick build:vercel` write set it, so the build is found wherever the platform starts them.

## 0.1.0

### Minor Changes

- [#852](https://github.com/forinda/kick-js/pull/852) [`e977e0a`](https://github.com/forinda/kick-js/commit/e977e0ad98215348831a14d4a22624372529e5b0) Thanks [@forinda](https://github.com/forinda)! - New package: an Inertia.js v3 adapter. `InertiaAdapter` renders pages returned with `inertia(component, props)` — HTML on a first visit, JSON on an Inertia visit — with partial reloads, deferred / optional / merge props, the asset version check, 303 redirects, flash data, validation errors through the session (`inertiaErrorHandler`), error and not-found pages (`errorPage`, `inertiaNotFound`), server-side rendering, and Vite assets in dev and production. Works on Express, Fastify and h3.
