---
'@forinda/kickjs': minor
---

feat(errors): structured KickError with code, cause, and fix hint

Framework-thrown errors are now `KickError` instances — a multi-line, scannable shape with a stable code, a cause explanation, an actionable fix, and a docs URL.

```
KICK001: No provider for UserService

  Cause:
    UserService was requested from the DI container but no binding
    is registered. This usually means one of:
      • The class is decorated with @Service() / @Repository() / @Controller(),
        but its enclosing module isn't passed to bootstrap({ modules: [...] }).
      • The class isn't decorated at all (decorators register the binding).
      • You're injecting a token (created with createToken()) that nothing
        provides — add a Container.register(TOKEN, ...) call or a module that
        binds it.

  Fix:
    If UserService lives in a module, add the module to bootstrap:

      bootstrap({
        modules: [
          UsersModule,        // add this
          OtherModule,
        ],
      })

  Docs:
    https://forinda.github.io/kick-js/guide/dependency-injection#registering-services
```

**First catalog pass — 5 errors upgraded:**

| Code      | When it fires                                                                |
| --------- | ---------------------------------------------------------------------------- |
| `KICK001` | DI: no provider registered for the requested token                           |
| `KICK002` | DI: REQUEST-scoped binding resolved without request-scope middleware mounted |
| `KICK003` | DI: REQUEST-scoped binding resolved outside an HTTP request                  |
| `KICK004` | Config: `@Value('X')` resolved but env var not set and no default given      |
| `KICK005` | Module: `routes()` declared a path without `controller` or `router`          |

More framework errors will migrate to `KickError` over time. Codes are stable and never reused.

**API:**

- `KickError` class — extends `Error`. Holds `code`, `summary`, `cause`, `fix`, `docsUrl`, `context`. `.message` carries the full multi-line plain-text body so Node's default `Error.toString()` surfaces the helpful version automatically.
- `formatKickError(err, { color })` — ANSI-colored renderer for terminal output. Honors `NO_COLOR` / `FORCE_COLOR` env vars when the `color` option is omitted.
- All five catalog entries exposed via factory functions (`noProviderError`, `envValueMissingError`, etc.) for use by adopters' own integrations.

**Backward compat:** errors still `instanceof Error`. Adopter code that catches generic `Error` keeps working. The previous error `message` substrings are replaced — adopters matching on those (e.g. `err.message.includes('No binding found')`) need to update to match the new wording, OR — better — switch to matching on `err.code` which is stable.

**Tests:** 17 new in `kick-error.test.ts` (class, formatter, ANSI gating, every catalog entry, code uniqueness). Full kickjs suite **509/509 pass**.

Closes B.2 (first pass) from the roadmap.
