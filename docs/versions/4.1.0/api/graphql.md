# @forinda/kickjs-graphql

GraphQL support for KickJS — decorator-driven resolvers with auto-generated schema and GraphiQL playground.

## Installation

```bash
pnpm add @forinda/kickjs-graphql graphql
# Or use the CLI:
kick add graphql
```

## Quick Start

```ts
import 'reflect-metadata'
import * as graphql from 'graphql'
import { bootstrap } from '@forinda/kickjs'
import { GraphQLAdapter } from '@forinda/kickjs-graphql'
import { UserResolver } from './resolvers/user.resolver'

const typeDefs = `
  type User {
    id: ID!
    name: String!
    email: String!
  }
`

bootstrap({
  modules: [],
  adapters: [
    new GraphQLAdapter({
      graphql,                          // pass the graphql module
      resolvers: [UserResolver],
      typeDefs,                         // only custom types — Query/Mutation auto-generated
    }),
  ],
})
```

Then visit `http://localhost:3000/graphql` for the GraphiQL playground.

## Adapter Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `graphql` | `any` | **required** | The `graphql` module (`import * as graphql from 'graphql'`) |
| `resolvers` | `any[]` | `[]` | Resolver classes decorated with `@Resolver` |
| `typeDefs` | `string` | — | Custom type definitions (only custom types, NOT Query/Mutation) |
| `path` | `string` | `'/graphql'` | URL path for the endpoint |
| `playground` | `boolean` | `true` (dev) | Enable GraphiQL interactive playground |

## Decorators

### @Resolver(typeName?)

```ts
@Service()
@Resolver('User')
export class UserResolver { ... }
```

### @Query(name?, options?)

```ts
@Query('users', { returnType: '[User!]!' })
findAll() { return this.users }

@Query('user', { returnType: 'User' })
findById(@Arg('id', 'ID!') id: string) { ... }
```

The `returnType` must match your custom types in `typeDefs`. Without it, defaults to `String`.

### @Mutation(name?, options?)

```ts
@Mutation('createUser', { returnType: 'User!' })
create(@Arg('name', 'String!') name: string, @Arg('email', 'String!') email: string) { ... }
```

### @Arg(name, type?)

Injects a named GraphQL argument. The `type` string is used in the auto-generated schema.

```ts
@Arg('id', 'ID!')       // required ID
@Arg('name', 'String!')  // required string
@Arg('limit', 'Int')     // optional int
```

## How Schema Generation Works

The adapter auto-generates `Query` and `Mutation` types from your `@Query`/`@Mutation` decorators:

```
Your typeDefs (custom types only):     Auto-generated from decorators:
─────────────────────────────────     ──────────────────────────────
type User {                           type Query {
  id: ID!                               users: [User!]!
  name: String!                         user(id: ID!): User
  email: String!                      }
}
                                      type Mutation {
                                        createUser(name: String!, email: String!): User!
                                      }
```

**Do NOT define Query or Mutation in your typeDefs** — they will conflict with the auto-generated ones.

## Full Example

### Resolver

```ts
// src/resolvers/user.resolver.ts
import { Service } from '@forinda/kickjs'
import { Resolver, Query, Mutation, Arg } from '@forinda/kickjs-graphql'

@Service()
@Resolver('User')
export class UserResolver {
  private users = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ]

  @Query('users', { returnType: '[User!]!' })
  findAll() {
    return this.users
  }

  @Query('user', { returnType: 'User' })
  findById(@Arg('id', 'ID!') id: string) {
    return this.users.find((u) => u.id === id) ?? null
  }

  @Mutation('createUser', { returnType: 'User!' })
  create(@Arg('name', 'String!') name: string, @Arg('email', 'String!') email: string) {
    const user = { id: String(this.users.length + 1), name, email }
    this.users.push(user)
    return user
  }
}
```

### Type Definitions

```ts
// src/resolvers/typedefs.ts
export const typeDefs = `
  type User {
    id: ID!
    name: String!
    email: String!
  }
`
```

### Sample Queries

Try these in the GraphiQL playground at `/graphql`:

```graphql
# List all users
query {
  users {
    id
    name
    email
  }
}

# Get a single user
query {
  user(id: "1") {
    name
    email
  }
}

# Create a user
mutation {
  createUser(name: "Charlie", email: "charlie@example.com") {
    id
    name
  }
}
```

### With curl

```bash
# Query
curl -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ users { id name email } }"}'

# Mutation
curl -X POST http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation { createUser(name: \"Eve\", email: \"eve@test.com\") { id name } }"}'
```

## CLI Generator

```bash
kick g resolver user
```

Generates `user.resolver.ts` with CRUD queries/mutations and `user.typedefs.ts` with the type definition.

## Related

- [Custom Decorators](../guide/custom-decorators.md) — extend the decorator system
- [@forinda/kickjs-core](./core.md) — DI container, decorators
