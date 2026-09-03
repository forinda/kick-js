---
'@forinda/kickjs': minor
---

`rateLimit({ exemptWhen })` — the app-wide limiter reads route flags (phase 3 of `route-flags-design.md`).

`rateLimit()` runs before route matching, so it has no `ctx.route` to read, and its only exemption handle was `skipPaths` — an exact pathname that cannot express `/probe/:name` and drifts when `apiPrefix` or a module's `version` changes.

It now reads a **policy table**: every mounted route registers its method, path and resolved flags at boot, and the limiter looks up the incoming request.

```ts
const Public = defineRouteFlag('auth.public')

bootstrap({
  modules,
  middlewares: [rateLimit({ max: 60, exemptWhen: 'auth.public' })],
})
```

```ts
@Public
@Get('/probe/:name')   // exempt for every :name — skipPaths could not say this
probe(ctx: RequestContext) {}
```

**A request matching no route matches no flags and stays limited.** That is why this middleware keeps running before matching rather than becoming a route-scoped guard: an abuse control has to see traffic that hits nothing.

`exemptWhen` takes the same name / any-of list / predicate as everywhere else. `skipPaths` still applies to paths that are not routes at all — a static mount, a proxied prefix — which no flag can describe.

Pre-match middleware of your own can read the table by declaring the slot with the exported `bindRoutePolicy(handler, receive)`. The table is per-application, not a global, so two apps in one process never see each other's routes.
