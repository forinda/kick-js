---
'@forinda/kickjs': minor
'@forinda/kickjs-cli': minor
'@forinda/kickjs-testing': patch
---

An app on Fastify or h3 type-checks without `@types/express` or `@types/multer`.

- Middleware types are KickJS's own: `ConnectRequest`, `ConnectResponse`, `ConnectNext`, `ConnectHandler`, `ConnectErrorHandler`. Express middleware (`express.json()`, `cors()`, handlers typed with Express's `Request`) fits them.
- Uploaded files are typed `UploadedFile` (`ctx.file`, `ctx.files`), and `upload({ storage })` takes an `UploadStorageEngine`; multer's files and storage engines fit both.
- `ExpressRuntimeTypes` is exported from `@forinda/kickjs/express`.
- `ctx.app`, `getRuntimeApp()`, `ctx.req` and `ctx.res` are typed for the app's runtime by `kick typegen`, now for Express apps too. Without typegen, cast them to your engine's types.
- `buildRoutes()` and `materializeRouter()` return a `ConnectHandler`.
