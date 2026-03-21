import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { OtelAdapter } from '@forinda/kickjs-otel'
// import { QueueAdapter, BullMQProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new OtelAdapter({ serviceName: 'microservice-api' }),
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: 'microservice-api', version: '0.7.0' },
    }),
    // Uncomment when Redis is available:
    // new QueueAdapter({
    //   provider: new BullMQProvider({ host: 'localhost', port: 6379 }),
    // }),
  ],
})
