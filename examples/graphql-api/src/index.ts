import 'reflect-metadata'
import * as graphql from 'graphql'
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { GraphQLAdapter } from '@forinda/kickjs-graphql'
import { modules } from './modules'
import { UserResolver } from './resolvers/user.resolver'
import { PostResolver } from './resolvers/post.resolver'
import { typeDefs } from './resolvers/typedefs'

bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    new GraphQLAdapter({
      graphql,
      resolvers: [UserResolver, PostResolver],
      typeDefs,
    }),
  ],
})
