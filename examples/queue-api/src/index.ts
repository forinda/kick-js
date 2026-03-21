import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
// import { QueueAdapter, BullMQProvider } from '@forinda/kickjs-queue'
import { modules } from './modules'

// Import job processors so decorators register
import './jobs/email.job'
import './jobs/report.job'

bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: { title: 'queue-api', version: '0.7.0' },
    }),
    // QueueAdapter requires Redis to be running.
    // Uncomment when Redis is available:
    // new QueueAdapter({
    //   provider: new BullMQProvider({ host: 'localhost', port: 6379 }),
    // }),
  ],
})
