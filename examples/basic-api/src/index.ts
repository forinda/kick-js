import 'reflect-metadata'
import express from 'express'
import { bootstrap, requestId } from '@kickjs/http'
import { SwaggerAdapter } from '@kickjs/swagger'
import { modules } from './modules'
import { requestLogger } from './middleware/request-logger'
import { CorsAdapter } from './adapters/cors.adapter'
import { HealthAdapter } from './adapters/health.adapter'

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,

  adapters: [
    new CorsAdapter({ origin: '*', credentials: false }),
    new HealthAdapter(),
    new SwaggerAdapter({
      info: { title: 'Todo API', version: '1.0.0', description: 'KickJS example API' },
    }),
  ],

  middleware: [requestId(), express.json({ limit: '1mb' }), requestLogger()],
})
