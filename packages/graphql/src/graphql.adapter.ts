import {
  Logger,
  defineAdapter,
  type AdapterContext,
  type Container,
  getClassMetaOrUndefined,
  getClassMeta,
  getMethodMeta,
} from '@forinda/kickjs'
import type { Request, Response } from 'express'
import express from 'express'
import {
  RESOLVER_META,
  QUERY_META,
  MUTATION_META,
  ARG_META,
  type ResolverMeta,
  type FieldMeta,
  type ArgMeta,
} from './decorators'

const log = Logger.for('GraphQLAdapter')

export interface GraphQLAdapterOptions {
  /** URL path for the GraphQL endpoint (default: '/graphql') */
  path?: string
  /** Enable GraphQL Playground/GraphiQL UI (default: true in dev) */
  playground?: boolean
  /** Resolver classes decorated with @Resolver */
  resolvers: any[]
  /** Custom GraphQL schema string (merged with auto-generated schema) */
  typeDefs?: string
  /**
   * The graphql module — pass `import * as graphql from 'graphql'` or `require('graphql')`.
   * Required because the adapter can't resolve the graphql package from its own node_modules.
   */
  graphql: any
}

/**
 * GraphQL adapter for KickJS.
 *
 * Scans `@Resolver` classes for `@Query` and `@Mutation` methods,
 * builds a GraphQL schema, and mounts a `/graphql` endpoint.
 *
 * @example
 * ```ts
 * import { GraphQLAdapter } from '@forinda/kickjs-graphql'
 * import * as graphql from 'graphql'
 *
 * bootstrap({
 *   modules,
 *   adapters: [
 *     GraphQLAdapter({
 *       resolvers: [UserResolver, PostResolver],
 *       graphql,
 *     }),
 *   ],
 * })
 * ```
 */
export const GraphQLAdapter = defineAdapter<GraphQLAdapterOptions>({
  name: 'GraphQLAdapter',
  defaults: {
    path: '/graphql',
  },
  build: (config) => {
    // `playground` defaults are environment-aware so each instance reads
    // NODE_ENV at construction time (matches the legacy class behaviour
    // — production builds default to playground off without the adopter
    // having to pass a flag).
    const playground = config.playground ?? process.env.NODE_ENV !== 'production'
    const path = config.path ?? '/graphql'

    function buildArgString(ResolverClass: any, handlerName: string): string {
      const argMeta: ArgMeta[] = getMethodMeta<ArgMeta[]>(ARG_META, ResolverClass, handlerName, [])
      if (argMeta.length === 0) return ''
      const args = argMeta
        .sort((a, b) => a.paramIndex - b.paramIndex)
        .map((a) => `${a.name}: ${a.type ?? 'String'}`)
        .join(', ')
      return `(${args})`
    }

    function buildSchema(graphqlLib: any, container: Container) {
      const queryFields: string[] = []
      const mutationFields: string[] = []
      const rootValue: Record<string, any> = {}

      for (const ResolverClass of config.resolvers) {
        const meta = getClassMetaOrUndefined<ResolverMeta>(RESOLVER_META, ResolverClass)
        if (!meta) continue

        const queries = getClassMeta<FieldMeta[]>(QUERY_META, ResolverClass, [])
        const mutations = getClassMeta<FieldMeta[]>(MUTATION_META, ResolverClass, [])

        for (const q of queries) {
          const args = buildArgString(ResolverClass, q.handlerName)
          const returnType = q.returnType ?? 'String'
          queryFields.push(`  ${q.name}${args}: ${returnType}`)

          rootValue[q.name] = async (argsObj: any, context: any) => {
            const instance = container.resolve(ResolverClass)
            const argMeta: ArgMeta[] = getMethodMeta<ArgMeta[]>(
              ARG_META,
              ResolverClass,
              q.handlerName,
              [],
            )
            const params = argMeta
              .sort((a, b) => a.paramIndex - b.paramIndex)
              .map((a) => argsObj[a.name])
            if (params.length === 0) {
              return instance[q.handlerName](argsObj, context)
            }
            return instance[q.handlerName](...params, context)
          }
        }

        for (const m of mutations) {
          const args = buildArgString(ResolverClass, m.handlerName)
          const returnType = m.returnType ?? 'String'
          mutationFields.push(`  ${m.name}${args}: ${returnType}`)

          rootValue[m.name] = async (argsObj: any, context: any) => {
            const instance = container.resolve(ResolverClass)
            const argMeta: ArgMeta[] = getMethodMeta<ArgMeta[]>(
              ARG_META,
              ResolverClass,
              m.handlerName,
              [],
            )
            const params = argMeta
              .sort((a, b) => a.paramIndex - b.paramIndex)
              .map((a) => argsObj[a.name])
            if (params.length === 0) {
              return instance[m.handlerName](argsObj, context)
            }
            return instance[m.handlerName](...params, context)
          }
        }
      }

      let typeDefs = ''
      if (queryFields.length > 0) {
        typeDefs += `type Query {\n${queryFields.join('\n')}\n}\n\n`
      }
      if (mutationFields.length > 0) {
        typeDefs += `type Mutation {\n${mutationFields.join('\n')}\n}\n\n`
      }

      // Merge custom typeDefs
      if (config.typeDefs) {
        typeDefs = config.typeDefs + '\n\n' + typeDefs
      }

      if (!typeDefs.trim()) {
        typeDefs = 'type Query { _empty: String }'
      }

      const schema = graphqlLib.buildSchema(typeDefs)
      return { schema, rootValue }
    }

    function renderPlayground(): string {
      return `<!DOCTYPE html>
<html>
<head>
  <title>GraphQL Playground</title>
  <link rel="stylesheet" href="https://unpkg.com/graphiql@3/graphiql.min.css" />
</head>
<body style="margin:0;height:100vh;">
  <div id="graphiql" style="height:100vh;"></div>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/graphiql@3/graphiql.min.js"></script>
  <script>
    const fetcher = GraphiQL.createFetcher({ url: window.location.href });
    ReactDOM.createRoot(document.getElementById('graphiql')).render(
      React.createElement(GraphiQL, { fetcher })
    );
  </script>
</body>
</html>`
    }

    return {
      beforeMount({ app, container }: AdapterContext): void {
        // Register resolver classes in DI
        for (const ResolverClass of config.resolvers) {
          container.register(ResolverClass, ResolverClass)
        }

        const graphqlLib = config.graphql
        if (!graphqlLib?.buildSchema) {
          log.warn(
            'graphql module not provided. Pass { graphql: require("graphql") } to GraphQLAdapter.',
          )
          return
        }

        const { schema, rootValue } = buildSchema(graphqlLib, container)
        log.info(`GraphQL endpoint: ${path}`)
        if (playground) {
          log.info(`GraphQL Playground: ${path} (GET)`)
        }

        const jsonParser = express.json()

        app.post(path, jsonParser, async (req: Request, res: Response) => {
          const { query, variables, operationName } = req.body ?? {}
          if (!query) {
            res.status(400).json({ errors: [{ message: 'Query is required' }] })
            return
          }
          try {
            const result = await graphqlLib.graphql({
              schema,
              source: query,
              rootValue,
              variableValues: variables,
              operationName,
              contextValue: { req, res, container },
            })
            res.json(result)
          } catch (err: any) {
            res.status(500).json({ errors: [{ message: err.message }] })
          }
        })

        // GET for playground/introspection
        app.get(path, (_req: Request, res: Response) => {
          if (playground) {
            res.type('html').send(renderPlayground())
          } else {
            res.status(404).json({ message: 'GraphQL Playground disabled' })
          }
        })
      },
    }
  },
})
