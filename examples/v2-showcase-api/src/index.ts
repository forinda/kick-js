import 'reflect-metadata'
import express from 'express'
import {
  bootstrap,
  requestId,
  requestLogger,
  helmet,
  cors,
} from '@forinda/kickjs'
import { DevToolsAdapter } from '@forinda/kickjs-devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { modules } from './modules'

const devtools = DevToolsAdapter({
  exposeConfig: true,
  configPrefixes: ['APP_', 'NODE_ENV'],
})

const swagger = SwaggerAdapter({
  info: {
    title: 'v2 Showcase API',
    version: '2.0.1',
    description: 'KickJS v2 showcase: request-scoped DI, health checks, Vite plugin, DevTools',
  },
})

// Export the app for the Vite plugin (dev mode).
// In production, bootstrap() auto-starts the HTTP server.
export const app = await bootstrap({
  modules,
  adapters: [devtools, swagger],
  middleware: [
    helmet(),
    cors({ origin: '*' }),
    requestId(),
    requestLogger(),
    express.json(),
  ],
})
