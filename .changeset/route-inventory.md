---
'@forinda/kickjs': minor
---

Know what each port serves. `app.getRoutes()` now lists every route — the ones adapters add through `ctx.http` / `ctx.management.http` too (`/metrics`, `/_debug/*`, an adapter's own), static directories as `/prefix/*` — each with `source` (`'module'` or `'adapter'`) and `port` (`'app'` or `'management'`). With a management port, the startup log lists its routes. Fixed: with a management port, the health routes were still reported to `onRouteMount`, so the OpenAPI spec documented `/health/live` and `/health/ready` on the public server, where they answer 404.
