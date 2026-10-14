---
'@forinda/kickjs': patch
---

Less work per request:

- `validate()` detects each schema's type once, on the first request, instead of on every request.
- `Application.handle()`, which the serverless handler and `app.fetch()` call per request, builds the engine's node handler once per engine app.
- Fastify routes synchronously once ready, with no promise hop per request.
- `helmet()` and `cors()` build their header values when created.
- The matched route (`ctx.route`) is one shared, frozen object per route.
- Contributors list their dependency specs once.
