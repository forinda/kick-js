---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
'@forinda/kickjs-testing': patch
---

Kick's typings no longer come from `express`. Middleware is typed with kick's own connect types — `ConnectRequest`, `ConnectResponse`, `ConnectNext`, `ConnectHandler`, `ConnectErrorHandler` — used by `AdapterMiddleware`, `MiddlewareEntry`, `ctx.http.use()`, plugins and the built-in middleware. Express middleware (`express.json()`, `cors()`, a handler typed with Express's `Request`) fits them as is. No published typing outside the new `@forinda/kickjs/express` subpath imports `express`, so an app on Fastify or h3 type-checks without `@types/express`.

- `ExpressRuntimeTypes` moved to `@forinda/kickjs/express`, beside `expressRuntime`, `buildRoutes` and `materializeRouter` (still exported from the root too).
- `ActiveRuntime` without a `KickRuntimeRegister` augmentation is the connect types and an `unknown` app, not Express. `kick typegen` now writes the augmentation for the Express runtime too (`runtime: 'express'` or unset), so a generated app sees `AdapterContext.app`, `getRuntimeApp()` and `ctx.req` / `ctx.res` as Express's types, as before. An app that doesn't run typegen and reaches for Express members on them casts, or adds the augmentation itself.
- `buildRoutes()` and `materializeRouter()` return a `ConnectHandler` (the Express `Router` underneath).
- `createTestApp().expressApp` is typed `ActiveRuntime['app']`.
- `ctx.file` / `ctx.files` are typed `UploadedFile` (multer's shape: the file fields, `buffer`, and `destination` / `filename` / `path` from disk storage) instead of `Express.Multer.File`, and `upload({ storage })` takes an `UploadStorageEngine` — `multer.diskStorage()` and `multer.memoryStorage()` fit both — so the typings need no `@types/multer` either.
