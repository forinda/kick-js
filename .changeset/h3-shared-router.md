---
'@forinda/kickjs': patch
---

Two HTTP-runtime route-reachability fixes surfaced by linked-build testing:

- **h3:** routes from any source past the first 404'd (`/health`, devtools `/_debug/*`, ad-hoc adapter routes) with `Cannot find any path matching …`. h3's `createRouter` is terminal — on no match it throws rather than falling through like an Express Router — so mounting each source as its own router let the first shadow the rest. The runtime now uses one shared router per app (registered after the connect middleware), and dispatches the router's no-match 404 through `onError` to the framework's notFound handler (or the Vite dev fall-through) instead of surfacing it as a logged error.
- **fastify:** a controller's root `@Get('/')` (mounted at the prefix) 404'd a trailing-slash request (`/api/v1/hello/`) because Fastify's router is strict by default, while Express and h3 are lenient. The runtime now sets `routerOptions.ignoreTrailingSlash`, so `${prefix}` and `${prefix}/` both resolve.

Conformance gains multi-mount-source and root-trailing-slash cases across express + fastify + h3.
