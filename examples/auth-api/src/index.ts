import 'reflect-metadata'
import express from 'express'
import { bootstrap, requestId } from '@kickjs/http'
import { SwaggerAdapter } from '@kickjs/swagger'
import { modules } from './modules'

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,

  adapters: [
    new SwaggerAdapter({
      info: {
        title: 'Auth API',
        version: '0.1.0',
        description: 'KickJS JWT authentication example',
      },
    }),
  ],

  middleware: [requestId(), express.json({ limit: '1mb' })],
})
