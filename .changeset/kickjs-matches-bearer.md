---
'@forinda/kickjs': minor
---

`matchesBearer(header, secret)` is exported from `@forinda/kickjs` and `@forinda/kickjs/web`: a constant-time check of an `Authorization: Bearer <secret>` header for shared-secret endpoints (cron triggers, metrics scrapes, webhooks), so apps no longer re-implement it with `timingSafeEqual`. The built-in cron trigger and `metricsAdapter({ token })` now share it; the cron trigger's comparison no longer reveals the secret's length through timing.
