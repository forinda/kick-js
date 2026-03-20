import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: {
        title: 'SSE Example API',
        version: '0.5.2',
        description:
          'Server-Sent Events example. Connect to /api/v1/events/clock, ' +
          '/api/v1/events/counter, or /api/v1/events/notifications with EventSource.',
      },
    }),
  ],
})
