---
'@forinda/kickjs': minor
---

Add the runtime-typed escape-hatch registry (M3a, spec §4.3b) — the type foundation the Fastify / h3 runtimes plug into.

- New augmentable `KickRuntimeRegister` interface plus `RuntimeTypeMap`, `ExpressRuntimeTypes`, and the `ActiveRuntime` resolver. With no augmentation, `ActiveRuntime` defaults to the Express type map.
- `AdapterContext.app` and the new `getRuntimeApp()` accessor are now typed `ActiveRuntime['app']` (Express by default), so a `kick/runtime` typegen augmentation can flip the engine-native escape-hatch types to Fastify / h3 without touching adapter code. `getExpressApp()` stays as a deprecated alias.

Mirrors the `KickDbRegister` / `KickEnv` augmentation mechanism. Zero behavior change and — under the default Express runtime — zero type change (`ActiveRuntime['app']` is `Express`). The request/response driver layer (`ctx.req.raw` / `ctx.res.raw`) and the Fastify runtime itself follow in later M3 steps.
