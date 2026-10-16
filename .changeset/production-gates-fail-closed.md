---
'@forinda/kickjs': patch
'@forinda/kickjs-swagger': patch
---

Production gates fail closed: an unset `NODE_ENV` is production, not development. Dev behaviour is on only when `NODE_ENV` is exactly `development` or `test`.

- `csrf()` / `csrfGuard()` and `session()` cookies default to `Secure`.
- The error handler leaves stacks, error summaries and `details` out of responses.
- `ctx.body`'s read-only dev proxy is off, the asset manifest is cached, and deploy-only startup checks run.
- `AdapterContext.isProduction` is `true` and `AdapterContext.env` defaults to `'production'`.
- `SwaggerAdapter({ disableInProd: true })` mounts no docs.

**Migration:** `kick dev` (Vite) and Vitest already set `NODE_ENV`, so they are unaffected. An app run another way (`node`, `tsx`) that relied on dev behaviour with `NODE_ENV` unset must set `NODE_ENV=development`.
