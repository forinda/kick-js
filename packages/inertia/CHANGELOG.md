# @forinda/kickjs-inertia

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
