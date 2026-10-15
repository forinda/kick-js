---
'@forinda/kickjs-testing': minor
---

`startService('postgres' | 'redis')` and `startContainer(spec)` start real services in Docker through Testcontainers (an optional peer) and return `{ url, host, port, stop() }`. `createTestApp` now passes `settings` and `validationError` through to the app, so a test can hand the URL to a settings section with `provide()`.
