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

// Export the app for the Vite plugin (dev mode)
export const app = await bootstrap({
  modules,
  adapters: [
    new DevToolsAdapter(),
    SwaggerAdapter({
      info: { title: 'v3-preview', version: '2.1.0' },
    }),
  ],
  middleware: [
    helmet(),
    cors({ origin: '*' }),
    requestId(),
    requestLogger(),
    express.json(),
  ],
})
