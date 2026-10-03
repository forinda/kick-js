---
description: Testing KickJS context contributors, middleware, adapters and plugins — runContributor, full-pipeline tests, middleware with a fake context, adapter lifecycle hooks and createTestPlugin.
---

# Testing Contributors, Middleware and Plugins

These are the pieces that run around your handlers. Each has a unit-level helper, and each is worth one integration test that proves it's wired in.

## Context contributors

`runContributor` runs one contributor's `resolve()` against a fake context, without a container or HTTP:

```ts
import { runContributor } from '@forinda/kickjs-testing'

const { value } = await runContributor(LoadProject, {
  initial: { tenant: { id: 't-1' } }, // keys it dependsOn, as upstream contributors would set them
  deps: { repo: new InMemoryProjectRepo([{ id: 'p-1', tenantId: 't-1' }]) },
})
expect(value).toEqual({ id: 'p-1', tenantId: 't-1' })
```

| Option      | Does                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| `deps`      | the resolved `deps`, by name — real services, fakes or mocks                             |
| `initial`   | values already on the context: what `dependsOn` contributors would have set              |
| `ctx`       | more fields on the fake context — `{ req: { headers: { host: 'acme.example.com' } } }`   |
| `env`       | env values `getEnv` / `ConfigService` return while `resolve()` runs, restored afterwards |
| `requestId` | the context's request id (default `'test-req'`)                                          |

It returns `{ value, ctx, meta }`: the resolved value, the fake context and everything set on it. A `resolve()` that throws rejects, so `await expect(runContributor(...)).rejects.toThrow()` checks a refusal.

An HTTP contributor that reads the request gets it through `ctx`, and one that reads config through `env`:

```ts
const { value } = await runContributor(ResolveTenantFromHost, {
  ctx: { req: { headers: { host: 'acme.example.com', 'x-forwarded-host': 'acme.app' } } },
  env: { TRUST_PROXY: true },
})
expect(value).toBe('acme')
```

`runContributor` skips the error matrix (`optional`, `onError`) and the ordering. To test those, and that the handler sees the value, run the real pipeline with an integration test. The [Context Decorators](../context-decorators.md#testing-contributors) guide has worked examples of each, including `onError` fallbacks and contributors reached through services.

## Middleware

A middleware is a function of `(ctx, next)`. Unit-test it with a fake context and a `next` spy:

```ts
const requireTenantHeader: MiddlewareHandler<RequestContext> = (ctx, next) => {
  if (!ctx.headers['x-tenant']) throw HttpException.badRequest('x-tenant is required')
  next()
}

it('passes a request with the header on', () => {
  const next = vi.fn()
  requireTenantHeader({ headers: { 'x-tenant': 'acme' } } as never, next)
  expect(next).toHaveBeenCalledOnce()
})

it('refuses one without', () => {
  expect(() => requireTenantHeader({ headers: {} } as never, vi.fn())).toThrow(
    'x-tenant is required',
  )
})
```

Then check it's attached where it should be, through HTTP:

```ts
it('guards the projects routes', async () => {
  const { client } = await createTestApp({ modules: [ProjectModule()] })
  await client().get('/api/v1/projects').expect(400)
  await client().withHeaders({ 'x-tenant': 'acme' }).get('/api/v1/projects').expect(200)
})
```

Global middleware (`cors()`, `helmet()`, `rateLimit()`) goes in `createTestApp({ middlewares })`. Given, the list replaces the default, so include the body parser your app uses (on Express, `express.json()`).

## Adapters

`createTestApp` runs adapters' `beforeMount` and `beforeStart` hooks during setup, as `bootstrap` does. `afterStart` (which needs a listening server) doesn't run:

```ts
it('registers the gateway client during setup', async () => {
  const order: string[] = []
  const adapter: AppAdapter = {
    name: 'Probe',
    beforeMount: () => {
      order.push('beforeMount')
    },
    beforeStart: () => {
      order.push('beforeStart')
    },
  }

  await createTestApp({ modules: [SomeModule()], adapters: [adapter] })
  expect(order).toEqual(['beforeMount', 'beforeStart'])
})
```

For an adapter that needs `afterStart`, like a WebSocket server attaching to the HTTP server, start a real app on port `0` ([WebSockets](./background.md#websockets)).

## Plugins

`createTestPlugin` builds one plugin in an isolated container, without HTTP. It runs the plugin's `register()`, and gives you its container, lifecycle hooks and contributors:

```ts
import { createTestPlugin } from '@forinda/kickjs-testing'

it('ships the flags service and contributor', async () => {
  const harness = await createTestPlugin(FlagsPlugin({ provider: scripted }))

  const flags = harness.container.resolve(FLAGS_SERVICE)
  expect(await flags.isOn('beta')).toBe(true)

  await harness.callOnReady()
  const ctx = harness.makeContext({ requestId: 'req-1' })
  await harness.runContributors(ctx)
  expect(ctx.get('flags')).toEqual({ beta: true })

  await harness.shutdown()
})
```

`harness.modules()`, `adapters()`, `middleware()` and `contributors()` return what the plugin ships, for assertions like "it exposes the module I expect". To test the plugin inside an app, pass it to `createTestApp({ plugins })`.
