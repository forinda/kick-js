// Must be first — instruments Node.js before any other imports
import './tracing'

import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { OtelAdapter } from '@forinda/kickjs-otel'
import { modules } from './modules'

bootstrap({
  modules,
  adapters: [
    new OtelAdapter({
      serviceName: 'otel-api-example',
      serviceVersion: '0.5.2',
      ignoreRoutes: ['/_debug/*', '/health'],
    }),
    new DevToolsAdapter(),
    new SwaggerAdapter({
      info: {
        title: 'OTel Example API',
        version: '0.5.2',
        description:
          'OpenTelemetry tracing example. Every request creates a span ' +
          'logged to the console. Try POST/GET/PUT/DELETE /api/v1/tasks.',
      },
    }),
  ],
})
