import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { OtelAdapter } from '@forinda/kickjs-otel'
// import { QueueAdapter, BullMQProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

export const app = await bootstrap({
  modules,
  adapters: [
    OtelAdapter({ serviceName: 'microservice-api' }),
    DevToolsAdapter(),
    SwaggerAdapter({
      info: { title: 'microservice-api', version: '0.7.0' },
    }),
    // Uncomment when Redis is available:
    // QueueAdapter({
    //   provider: new BullMQProvider({ host: 'localhost', port: 6379 }),
    // }),
  ],
})
