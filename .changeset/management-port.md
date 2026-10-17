---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

`bootstrap({ management: { port, host?, tls? } })` serves health checks on a second port, so the public port carries only your API — like Spring Boot's `management.server.port`. `/health/live` and `/health/ready` move there, your middleware doesn't run there, and readiness keeps answering while the app shuts down. `metricsAdapter({ management: true })` and `DevToolsAdapter({ management: true })` serve `/metrics` and `/_debug` there too, and adapters can add their own routes through `ctx.management`. Off by default; in `kick dev` and on serverless platforms everything stays on the one port. Readiness answers `503` with `status: 'starting'` until the app has started.
