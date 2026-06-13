---
'@forinda/kickjs': minor
---

Route the bootstrap path through the HTTP-runtime seam (M1b). `Application` now holds an `HttpRuntime` (default `expressRuntime()`) and drives it for app creation, every middleware registration, route mounting, the terminal not-found / error handlers, the production server, and HMR rebuilds — instead of calling Express directly. The new `ApplicationOptions.runtime` lets you supply a different engine driver.

No behavior change: Express stays the zero-config default, so existing apps are byte-for-byte unaffected (full suite passes untouched). Engine-native escape hatches (`getExpressApp()`, `AdapterContext.app`, the health-check routes) still resolve to the Express app under the default runtime; moving those onto the runtime's adapter facade is the next milestone (M2).

This makes the runtime load-bearing — the foundation the Fastify / h3 subpaths plug into later.
