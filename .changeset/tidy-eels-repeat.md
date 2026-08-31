---
'@forinda/kickjs-testing': minor
---

Let `createTestApp` run the engine you actually deploy.

The harness hardcoded Express and returned `expressApp`, so a project running
Fastify or h3 in production had its entire suite passing against a different
engine. Routing, body parsing, status handling and error mapping all live in the
runtime seam, so a green Express suite says nothing about any of them — the one
thing an integration test exists to rule out.

`createTestApp` now accepts `runtime`, the same value passed to `bootstrap()`:

```ts
import { fastifyRuntime } from '@forinda/kickjs/fastify'

const { app } = await createTestApp({ modules: [UserModule], runtime: fastifyRuntime() })
const res = await request(app.handle.bind(app)).get('/api/v1/users')
```

Drive the returned `app` rather than `expressApp`: `app.handle` is the
Application's own Node request listener and follows whichever runtime is
configured, so one suite can run against every engine.

`expressApp` still works under the Express runtime. Under any other engine it
now throws, instead of returning that engine's instance mistyped as
`express.Express` — which is how a suite silently exercises the wrong runtime.
