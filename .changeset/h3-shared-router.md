---
'@forinda/kickjs': patch
---

Fix the h3 runtime 404-ing routes from any source past the first (`/health`, devtools `/_debug/*`, ad-hoc adapter routes), with errors like `Cannot find any path matching /_debug/health`. h3's `createRouter` is terminal — on no match it throws a 404 rather than falling through to the next `app.use` layer like an Express Router — so mounting each route source as its own router let the first one shadow the rest. The runtime now keeps **one shared router** per app (all `mountRoutes` calls add to it), registers it once after the connect middleware, and dispatches the router's no-match 404 through `onError` to the framework's notFound handler (or the Vite dev fall-through) instead of surfacing it as a logged error.
