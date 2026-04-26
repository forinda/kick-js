# GraphQL with KickJS

KickJS doesn't ship a first-party GraphQL package — the ecosystem moves too fast and pulls in heavyweight dependencies for a shipped adapter to age well. Instead, this guide shows how to mount **your own** GraphQL adapter or plugin using the same `defineAdapter` / `definePlugin` / `defineHttpContextDecorator` tooling the framework uses internally. You get DI, lifecycle hooks, typed per-request context, and the Context Contributor pipeline — wired to whichever GraphQL runtime fits your stack.

::: tip Pick any GraphQL runtime
The patterns below work with `graphql-http`, `graphql-yoga`, Apollo Server's `expressMiddleware`, Pothos, and anything else that exposes an Express-compatible handler. Install the runtime you want and wrap it in one of the two KickJS factories below.
:::

## Pattern 1: Plugin that mounts a GraphQL HTTP handler

A `definePlugin` factory wraps any standards-compliant GraphQL HTTP handler and exposes it as `app.use(path, handler)`. Works with `graphql-http`, `graphql-yoga`, Apollo's `expressMiddleware`, etc.

```ts
// src/plugins/graphql.plugin.ts
import { createHandler } from 'graphql-http/lib/use/express'
import { buildSchema } from 'graphql'
import { definePlugin } from '@forinda/kickjs'

export interface GraphQlPluginOptions {
  /** Standalone schema string. Use `buildSchema()` to compile. */
  typeDefs: string
  /** Root resolver object (or per-field resolvers wired into the schema). */
  rootValue: Record<string, unknown>
  /** Path the handler mounts at. Default: `/graphql`. */
  path?: string
}

export const GraphQlPlugin = definePlugin<GraphQlPluginOptions>({
  name: 'GraphQlPlugin',
  defaults: { path: '/graphql' },
  build: (config) => {
    const schema = buildSchema(config.typeDefs)
    const handler = createHandler({ schema, rootValue: config.rootValue })

    return {
      middleware() {
        // The handler needs to be reachable as a regular Express handler;
        // returning it under a `path` entry mounts it before route matching.
        return [{ path: config.path, handler }]
      },
    }
  },
})
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { GraphQlPlugin } from './plugins/graphql.plugin'

const typeDefs = /* GraphQL */ `
  type Query { hello: String }
`
const rootValue = { hello: () => 'world' }

export const app = await bootstrap({
  modules: [],
  plugins: [GraphQlPlugin({ typeDefs, rootValue })],
})
```

## Pattern 2: Adapter with DI integration

If you need the GraphQL resolvers to pull services from the DI container, use a `defineAdapter` factory — `beforeMount` runs after DI is wired so resolvers can `container.resolve(SomeService)`:

```ts
// src/adapters/graphql.adapter.ts
import { createHandler } from 'graphql-http/lib/use/express'
import { buildSchema } from 'graphql'
import { defineAdapter, type AdapterContext } from '@forinda/kickjs'
import { UserService } from '../modules/users/user.service'

export interface GraphqlAdapterOptions {
  typeDefs: string
  path?: string
}

export const GraphqlAdapter = defineAdapter<GraphqlAdapterOptions>({
  name: 'GraphqlAdapter',
  defaults: { path: '/graphql' },
  build: (config) => ({
    beforeMount({ app, container }: AdapterContext) {
      const users = container.resolve(UserService)

      const schema = buildSchema(config.typeDefs)
      const rootValue = {
        users: () => users.findAll(),
        user: ({ id }: { id: string }) => users.findById(id),
      }

      app.use(config.path!, createHandler({ schema, rootValue }))
    },
  }),
})
```

## Per-request `ctx` access in resolvers

GraphQL HTTP handlers receive Express `(req, res)` per request. Wrap the handler in a thin Express middleware that constructs a `RequestContext`, then thread it through the GraphQL `contextValue`:

```ts
import { RequestContext, defineAdapter } from '@forinda/kickjs'

export const GraphqlAdapter = defineAdapter<GraphqlAdapterOptions>({
  name: 'GraphqlAdapter',
  build: (config) => ({
    beforeMount({ app, container }: AdapterContext) {
      const schema = buildSchema(config.typeDefs)
      app.use(config.path!, (req, res, next) => {
        const ctx = new RequestContext(req, res, next)
        const handler = createHandler({
          schema,
          rootValue: buildRootValue(container),
          context: () => ({ ctx, container }),  // resolvers can pull from here
        })
        handler(req, res, next)
      })
    },
  }),
})
```

Resolvers receive the `{ ctx, container }` shape via the GraphQL context argument and can call `ctx.get('user')` exactly like REST handlers.

## Subscriptions

For WebSocket subscriptions, use `graphql-ws` and attach to the running HTTP server inside `afterStart`:

```ts
import { useServer } from 'graphql-ws/lib/use/ws'
import { WebSocketServer } from 'ws'
import { defineAdapter, type AdapterContext } from '@forinda/kickjs'

export const GraphqlSubscriptionsAdapter = defineAdapter<{ schema: any; path?: string }>({
  name: 'GraphqlSubscriptionsAdapter',
  defaults: { path: '/graphql' },
  build: (config) => {
    let wss: WebSocketServer | undefined

    return {
      afterStart({ server }: AdapterContext) {
        wss = new WebSocketServer({ server, path: config.path })
        useServer({ schema: config.schema }, wss)
      },
      async shutdown() {
        await new Promise<void>((resolve) => wss?.close(() => resolve()))
      },
    }
  },
})
```

## DevTools integration

Surface query/mutation counts on the DevTools dashboard via the `introspect()` slot on the adapter:

```ts
import { defineAdapter } from '@forinda/kickjs'
import type { IntrospectionSnapshot } from '@forinda/kickjs-devtools-kit'

export const GraphqlAdapter = defineAdapter<GraphqlAdapterOptions>({
  name: 'GraphqlAdapter',
  build: (config) => {
    let queries = 0
    let mutations = 0
    let errors = 0
    // (increment from the GraphQL handler — wrap with a context plugin
    // if your runtime supports execute hooks, otherwise count from
    // the Express middleware that forwards into the handler)

    return {
      // ... beforeMount / shutdown as above

      introspect(): IntrospectionSnapshot {
        return {
          protocolVersion: 1,
          name: 'GraphqlAdapter',
          kind: 'adapter',
          state: { path: config.path ?? '/graphql' },
          metrics: { queries, mutations, errors },
        }
      },
    }
  },
})
```

The topology view shows live query/mutation rates next to the rest of the app's adapters.

## Recommended runtimes

| Use case | Pick |
|---|---|
| Code-first schema with strong types | [Pothos](https://pothos-graphql.dev/) + the plugin pattern above |
| SDL-first with custom resolvers | [`graphql-http`](https://github.com/graphql/graphql-http) + `buildSchema()` |
| Federation / subscriptions / file uploads | [Apollo Server](https://www.apollographql.com/docs/apollo-server/) — wrap with `expressMiddleware` |
| Edge / streaming | [GraphQL Yoga](https://the-guild.dev/graphql/yoga-server) |

All four expose an Express-compatible handler, so they slot into either of the patterns above without changing the KickJS-side code.

## Related

- [Plugins](../guide/plugins.md) — `definePlugin` factory reference
- [Adapters](../guide/adapters.md) — `defineAdapter` factory reference
- [Context Decorators](../guide/context-decorators.md) — typed per-request values from resolvers
