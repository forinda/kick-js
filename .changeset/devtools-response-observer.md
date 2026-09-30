---
'@forinda/kickjs-devtools': patch
---

The dashboard's request counters and per-route latency are fed from the framework's `onResponse` hook instead of their own middleware, on `@forinda/kickjs` releases that have it. Older releases keep the middleware.

Latency is now keyed by the full route pattern (`GET /api/v1/users/:id`). Before, two modules' routes with the same relative path (`/users/:id` and `/orders/:id`) shared one bucket.
