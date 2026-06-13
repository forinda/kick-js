---
'@forinda/kickjs': minor
---

Add the engine-agnostic adapter HTTP facade (M2a). `AdapterContext` now carries `http: AdapterHttp` — `route()` / `mount()` / `serveStatic()` / `use()` — the supported way for adapters to register routes, mounts, static dirs, and middleware without reaching for the raw Express `app`. Each call routes through the active `HttpRuntime`, so an adapter written against `ctx.http` works under any runtime.

`ctx.app` stays as the engine-native escape hatch (Express under the default runtime). Existing adapters that use `ctx.app` are unchanged. Migrating the first-party adapters (swagger / queue / mcp / devtools) onto `ctx.http` follows in M2b/M2c.

Note: `http` is a required field on `AdapterContext` (like `app`), so code that hand-builds a mock `AdapterContext` (e.g. in tests) must now include an `http` entry.

`RouteMeta.controller` / `handlerName` are now optional (ad-hoc routes registered via `ctx.http.route` have no controller behind them).
