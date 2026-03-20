import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
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
      resolvers: [UserResolver, PostResolver],
      typeDefs,
    }),
  ],
})
