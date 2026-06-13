---
'@forinda/kickjs': patch
---

Move the Application's last Express-specific calls onto the HTTP runtime, so `application.ts` no longer reaches for engine-specific APIs in its setup path:

- `disable('x-powered-by')` + `set('trust proxy')` now live in `expressRuntime.createApp(opts)`; `Application` passes `trustProxy` through at both the constructor and HMR-rebuild create sites. `RuntimeAppOptions.trustProxy` widened to include Express's function form.
- The `/health/live` and `/health/ready` endpoints now register through the `ctx.http` facade instead of `this.app.get(...)`.

Behavior is unchanged under the default Express runtime. The engine-native escape hatches (`getExpressApp()` / `getRuntimeApp()`, `AdapterContext.app`) stay typed `Express` — `ApplicationOptions.runtime` widens from `HttpRuntime<Express>` to generic once `app` becomes runtime-typed (with the Fastify / h3 work).
