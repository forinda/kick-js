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

const devtools = new DevToolsAdapter({
  exposeConfig: true,
  configPrefixes: ['APP_', 'NODE_ENV'],
})

const swagger = new SwaggerAdapter({
  info: {
    title: 'v2 Showcase API',
    version: '2.0.1',
    description: 'KickJS v2 showcase: request-scoped DI, health checks, Vite plugin, DevTools',
  },
})

bootstrap({
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
