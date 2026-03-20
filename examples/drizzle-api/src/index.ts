import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { DrizzleAdapter } from '@forinda/kickjs-drizzle'
import { db, sqlite } from './db'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new DrizzleAdapter({
      db,
      logging: true,
      onShutdown: () => sqlite.close(),
    }),
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: 'Drizzle API Example', version: '0.5.1' },
    }),
  ],
})
