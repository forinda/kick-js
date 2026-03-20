# @forinda/kickjs-graphql

GraphQL support for KickJS applications — decorator-driven resolvers with optional GraphiQL playground.

## Installation

```bash
pnpm add @forinda/kickjs-graphql graphql
```

## Exports

### Decorators

| Decorator | Description |
|-----------|-------------|
| `@Resolver(typeName?)` | Mark a class as a GraphQL resolver (optionally scoped to a type) |
| `@Query(name?)` | Mark a method as a GraphQL query field |
| `@Mutation(name?)` | Mark a method as a GraphQL mutation field |
| `@Subscription(name?)` | Mark a method as a GraphQL subscription field |
| `@Arg(name, options?)` | Inject a named argument into a resolver method |

### Adapter

| Export | Description |
|--------|-------------|
| `GraphQLAdapter` | AppAdapter that mounts the GraphQL endpoint on the HTTP server |

### Types

| Export | Description |
|--------|-------------|
| `GraphQLAdapterOptions` | Configuration options for `GraphQLAdapter` |
| `ResolverMeta` | Metadata stored by `@Resolver` |
| `QueryMeta` | Metadata stored by `@Query` |
| `MutationMeta` | Metadata stored by `@Mutation` |
| `SubscriptionMeta` | Metadata stored by `@Subscription` |

## GraphQLAdapter Options

```ts
interface GraphQLAdapterOptions {
  /** URL path for the GraphQL endpoint (default: '/graphql') */
  path?: string
  /** Enable the GraphiQL interactive playground (default: true in development) */
  playground?: boolean
  /** Array of resolver classes decorated with @Resolver */
  resolvers?: Function[]
  /** GraphQL type definitions (SDL string or DocumentNode) */
  typeDefs?: string | DocumentNode
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `'/graphql'` | URL path for the GraphQL endpoint |
| `playground` | `boolean` | `true` (dev) | Enable GraphiQL interactive playground |
| `resolvers` | `Function[]` | `[]` | Resolver classes decorated with `@Resolver` |
| `typeDefs` | `string \| DocumentNode` | — | GraphQL schema type definitions |

## Decorators

### @Resolver

Marks a class as a GraphQL resolver. Optionally scope it to a specific type name.

```ts
@Resolver()
export class RootResolver { ... }

@Resolver('User')
export class UserResolver { ... }
```

### @Query

Marks a method as a GraphQL query field. The method name is used as the field name unless overridden.

```ts
@Query()
users() { ... }

@Query('allUsers')
getUsers() { ... }
```

### @Mutation

Marks a method as a GraphQL mutation field.

```ts
@Mutation()
createUser(@Arg('input') input: CreateUserInput) { ... }
```

### @Subscription

Marks a method as a GraphQL subscription field. Return an `AsyncIterator`.

```ts
@Subscription()
onUserCreated() {
  return pubsub.asyncIterator('USER_CREATED')
}
```

### @Arg

Injects a named argument from the GraphQL field arguments into the method parameter.

```ts
@Query()
user(@Arg('id') id: string) { ... }

@Arg('limit', { nullable: true, defaultValue: 10 })
```

## GraphiQL Playground

When `playground` is enabled (the default in development), navigate to the GraphQL endpoint path in a browser to access the GraphiQL interactive IDE. This provides:

- Schema exploration and auto-complete
- Query history
- Variable and header editors
- Real-time documentation from your schema

## Example

```ts
import { Resolver, Query, Mutation, Arg } from '@forinda/kickjs-graphql'
import { Service, Autowired } from '@forinda/kickjs-core'

@Service()
@Resolver()
export class UserResolver {
  @Autowired()
  private userService!: UserService

  @Query()
  async users() {
    return this.userService.findAll()
  }

  @Query()
  async user(@Arg('id') id: string) {
    return this.userService.findById(id)
  }

  @Mutation()
  async createUser(@Arg('name') name: string, @Arg('email') email: string) {
    return this.userService.create({ name, email })
  }
}
```

### Bootstrap

```ts
import { bootstrap } from '@forinda/kickjs-core'
import { GraphQLAdapter } from '@forinda/kickjs-graphql'
import { UserResolver } from './resolvers/user.resolver'

bootstrap({
  modules,
  adapters: [
    new GraphQLAdapter({
      path: '/graphql',
      playground: true,
      resolvers: [UserResolver],
      typeDefs: `
        type User {
          id: ID!
          name: String!
          email: String!
        }

        type Query {
          users: [User!]!
          user(id: ID!): User
        }

        type Mutation {
          createUser(name: String!, email: String!): User!
        }
      `,
    }),
  ],
})
```

## Related

- [Adapters Guide](../guide/adapters.md) -- how adapters hook into the KickJS lifecycle
- [@forinda/kickjs-core](./core.md) -- DI container, decorators
- [@forinda/kickjs-http](./http.md) -- HTTP server that GraphQLAdapter attaches to
