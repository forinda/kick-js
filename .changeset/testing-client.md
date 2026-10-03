---
'@forinda/kickjs-testing': minor
---

Less test plumbing.

- **`createTestApp()` returns `client(options?)`:** a request client that goes through whichever runtime the app runs on.
  - Options: `headers`, `bearer`, `basePath` and `cookies` (keep a cookie jar).
  - `.as(token)` and `.withHeaders()` scope a new client from an existing one.
  - It needs `supertest`, now an optional peer.
- **`useTestApp(() => options, { shared?, reset?, client? })`:** from the new `@forinda/kickjs-testing/vitest` subpath, it registers the `beforeAll` / `afterAll` that build and shut down the app. `shared: true` keeps one app per worker for `isolate: false` suites.
- **`onTestReset(fn)` / `resetTestState()`:** reset in-memory fakes and caches between files or tests.
- **`runContributor` takes `ctx`:** extra fake-context fields, such as `req`, for HTTP contributors.
- **`runContributor` takes `env`:** env values for the resolver, restored afterwards.
