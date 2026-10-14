# @forinda/kickjs-inertia

## 0.1.0

### Minor Changes

- [#852](https://github.com/forinda/kick-js/pull/852) [`e977e0a`](https://github.com/forinda/kick-js/commit/e977e0ad98215348831a14d4a22624372529e5b0) Thanks [@forinda](https://github.com/forinda)! - New package: an Inertia.js v3 adapter. `InertiaAdapter` renders pages returned with `inertia(component, props)` — HTML on a first visit, JSON on an Inertia visit — with partial reloads, deferred / optional / merge props, the asset version check, 303 redirects, flash data, validation errors through the session (`inertiaErrorHandler`), error and not-found pages (`errorPage`, `inertiaNotFound`), server-side rendering, and Vite assets in dev and production. Works on Express, Fastify and h3.
