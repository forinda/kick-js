---
'@forinda/kickjs': minor
---

Observe every error and response from one place: `onError` / `onResponse` hooks, `reportError()`, and `diagnostics_channel` tracing.

- **Hooks:** adapters and plugins can declare `onError(error, info)` and `onResponse(info)`. They are observe-only, and a hook that throws is logged and skipped.
- **Where `onError` fires:**
  - request errors of any status, on Express, Fastify and h3, before the error handler (including a custom `bootstrap({ onError })`);
  - uncaught exceptions and unhandled rejections;
  - failed `waitUntil()` work;
  - anything passed to the new exported `reportError()`.

  `info` carries the `source`, the matched route pattern, the status and the request id.

- **`onResponse`:** gets method, path, the full route pattern (`/api/v1/users/:id`), status and duration. Responses are only timed while something listens.
- **`diagnostics_channel`:**
  - `kickjs:handler` is a tracing channel around each controller handler, for APM spans;
  - `kickjs:error` and `kickjs:response` carry the same data as the hooks.

  All are free without subscribers. The names are exported (`HANDLER_CHANNEL`, `ERROR_CHANNEL`, `RESPONSE_CHANNEL`), plus the `HandlerTraceContext` type.

- **`ctx.route.pattern`:** `MatchedRoute` gains `pattern`, the full mounted route pattern. `path` is still relative to the module mount.
