import 'reflect-metadata'
import express from 'express'
import { bootstrap, requestId } from '@forinda/kickjs-http'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,

  adapters: [
    new SwaggerAdapter({
      info: {
        title: 'Swagger Demo API',
        version: '1.0.0',
        description:
          'Demonstrates rich OpenAPI documentation with diverse Zod schemas, ' +
          'multiple response types, bearer auth, and tags.',
      },
      servers: [
        { url: 'http://localhost:3000', description: 'Local dev' },
      ],
      bearerAuth: true,
    }),
  ],

  middleware: [
    requestId(),
    express.json({ limit: '1mb' }),
  ],
})
