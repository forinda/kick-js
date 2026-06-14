---
'@forinda/kickjs': major
---

**Major release — the pluggable HTTP runtimes line.** `@forinda/kickjs` now runs on Express (default), Fastify, or h3 behind one `HttpRuntime` seam, selected with `bootstrap({ runtime })`. Express apps need no code changes (see the migration guide), but this is a major because the runtime/adapter refactor changed a few surfaces that adapter and tooling authors depend on:

- `RequestContext` response helpers (`json`/`html`/`sse`/`download`/`render`/`problem`) now return `RuntimeResponse` instead of the Express `Response` — they write through an engine-neutral response driver.
- `AdapterContext` gained a required `http` facade (`route`/`mount`/`serveStatic`/`use`) and `AdapterContext.app` / `getRuntimeApp()` are typed to the active runtime via the `KickRuntimeRegister` registry (Express by default).
- `getExpressApp()` is deprecated in favour of `getRuntimeApp()`.
- The default logger is `ConsoleLoggerProvider` (pino dropped — zero default deps).
- The Fastify and h3 runtimes carry no `express` dependency (static serving uses `serve-static`).

New: `@FileUpload` works on all three engines, `bootstrap({ runtime })`, the `@forinda/kickjs/fastify` and `@forinda/kickjs/h3` subpaths, cross-engine uploads, and the `KickRuntimeRegister` type registry.
