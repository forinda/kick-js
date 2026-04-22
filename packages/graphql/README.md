# @forinda/kickjs-graphql

GraphQL adapter for KickJS — decorator-driven resolvers (`@Resolver`, `@Query`, `@Mutation`, `@Subscription`, `@Arg`), auto schema generation, GraphiQL playground at `/graphql`.

## Install

```bash
kick add graphql
```

## Quick Example

```ts
// resolvers/user.resolver.ts
import { Resolver, Query, Mutation, Arg } from '@forinda/kickjs-graphql'

@Resolver()
export class UserResolver {
  @Query('users', '[User]')
  list() {
    return [{ id: '1', name: 'Alice' }]
  }

  @Mutation('createUser', 'User')
  create(@Arg('name') name: string, @Arg('email') email: string) {
    return { id: '2', name, email }
  }
}
```

```ts
// src/index.ts
import { bootstrap } from '@forinda/kickjs'
import { GraphQLAdapter } from '@forinda/kickjs-graphql'
import { modules } from './modules'
import { UserResolver } from './resolvers/user.resolver'

export const app = await bootstrap({
  modules,
  adapters: [GraphQLAdapter({ resolvers: [UserResolver], playground: true })],
})
```

> Note: `GraphQLAdapter` still uses the legacy `new` form; migration to `defineAdapter` is on the roadmap.

## Documentation

[forinda.github.io/kick-js/api/graphql](https://forinda.github.io/kick-js/api/graphql)

## License

MIT
