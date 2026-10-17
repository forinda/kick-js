---
'@forinda/kickjs': minor
'@forinda/kickjs-devtools': minor
---

`bootstrap({ management: { port, host? } })` serves `/health/live` and `/health/ready` on a second port — the same app and container, a second listener, like Spring Boot's `management.server.port`. The management port skips the app's middleware, keeps answering while the public port drains, and closes last. Adapters get `ctx.management` (`http`, and `server` from `afterStart`) to serve routes there; `DevToolsAdapter({ management: true })` moves `/_debug` and its event bus off the public port. Off by default, and ignored in dev mode and on serverless platforms.
