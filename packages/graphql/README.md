# @forinda/kickjs-graphql

GraphQL module for KickJS with decorator-based resolvers, schema generation, and playground.

## Install

```bash
# Using the KickJS CLI (recommended — auto-installs peer dependencies)
kick add graphql

# Manual install
pnpm add @forinda/kickjs-graphql graphql
```

## Features

- `GraphQLAdapter` — lifecycle adapter with GraphiQL playground
- Decorator-driven resolvers: `@Resolver`, `@Query`, `@Mutation`, `@Subscription`, `@Arg`
- Automatic schema generation from decorated classes
- DI-integrated resolvers

## Quick Example

```typescript
import { GraphQLAdapter, Resolver, Query, Mutation, Arg } from '@forinda/kickjs-graphql'

@Resolver()
class UserResolver {
  @Query('users', '[User]')
  async list() {
    return [{ id: '1', name: 'Alice' }]
  }

  @Mutation('createUser', 'User')
  async create(@Arg('name') name: string, @Arg('email') email: string) {
    return { id: '2', name, email }
  }
}

bootstrap({
  modules,
  adapters: [
    new GraphQLAdapter({
      resolvers: [UserResolver],
      playground: true,
    }),
  ],
})
```

Visit `http://localhost:3000/graphql` for the GraphiQL playground.

## Documentation

[Full documentation](https://forinda.github.io/kick-js/)

## License

MIT
