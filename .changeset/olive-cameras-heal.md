---
'@forinda/kickjs': minor
---

Route flags can now be declared at the module mount, and the built-in health probes accept them.

`ModuleRoutes.flags` applies flags to every route a mount produces — the site a
decorator cannot reach, because a module mounts controllers it may not own.
Precedence is method > class > mount, so a class or method declaration still
wins and `@Flag.off` still removes an inherited flag.

```ts
routes: () => ({ path: '/webhooks', controller: WebhooksController, flags: ['auth.public'] })
```

The health module is the first consumer. Its two probes sit inside the
middleware chain, so app-wide auth applies to them, and until now the only way
out was exempting `/health/live` and `/health/ready` by pathname:

```ts
bootstrap({ health: { flags: ['auth.public'] } })
```

The framework still names no flags — the name is yours, and every consumer that
already reads it (`skipWhen`, `exemptWhen`, `SwaggerAdapter({ publicFlag })`)
covers the probes with no further wiring. `getRouteFlags()` reports mount flags
too, so an OpenAPI spec or DevTools listing cannot disagree with what the
runtime resolved.
