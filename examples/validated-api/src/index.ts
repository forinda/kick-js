import 'reflect-metadata'
import express from 'express'
import { bootstrap, requestId } from '@forinda/kickjs-http'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

bootstrap({
  modules,
  middleware: [
    requestId(),
    express.json({ limit: '1mb' }),
  ],
  adapters: [
    new SwaggerAdapter({
      info: {
        title: 'Validated API',
        version: '1.0.0',
        description:
          'Example API showcasing query parsing, Zod validation, and Swagger schema generation',
      },
      docsPath: '/docs',
      redocPath: '/redoc',
      specPath: '/openapi.json',
    }),
  ],
})
