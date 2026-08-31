---
'@forinda/kickjs': minor
---

The built-in health endpoints are a module you can see.

`GET /health/live` and `GET /health/ready` were mounted straight onto the engine
with `http.route()`, ahead of the middleware chain. That worked, and made them
invisible in three ways:

- **The OpenAPI spec never had them.** The generator builds from controller
  decorators, and a raw route carries none — so the only two routes the
  framework itself serves were missing from every spec.
- **`logRouteTable` never listed them**, along with anything else reading the
  route registry.
- **Nothing in an adopter's code said they existed.** `kick g adapter` documents
  `onHealthCheck`, but the endpoint consuming it appeared nowhere, so people
  wrote their own `/health/ready` next to the built-in one.

They are now `healthModule()` — a `defineModule` factory with a real
`HealthController`, registered automatically. It reads draining state and
adapter checks through a `HEALTH_PROBE` token rather than Application
internals, so a replacement module can satisfy the same contract.

Paths and bodies are unchanged, verified on Express, Fastify and h3. `prefix:
false` keeps them at the root: a probe URL an orchestrator is configured against
must not move when `apiPrefix` or the API version does.

**Behaviour change worth knowing:** mounting with the other modules puts them
INSIDE the middleware chain, where they previously sat ahead of it. An app with
global auth will now require auth on its probes. That is the correct default —
an app controls its own auth, and a framework route quietly bypassing it is the
surprise — but it is a change. Exempt the path as you would any other, or pass
`health: false` and mount your own.

`ModuleRoutes` gains `prefix?: false` for this, and it is useful beyond health:
a provider's fixed webhook URL or a `/.well-known` document has the same problem
of being dragged around by a prefix that has nothing to do with it.
