import 'reflect-metadata'
import express from 'express'
import { bootstrap, requestId } from '@forinda/kickjs-http'
import { DevToolsAdapter } from '@forinda/kickjs-http/devtools'
import { SwaggerAdapter } from '@forinda/kickjs-swagger'
import { WsAdapter } from '@forinda/kickjs-ws'
import { modules } from './modules'

// Import all WS controllers (single barrel — add new ones in ws/index.ts)
import './ws'

const wsAdapter = new WsAdapter({ path: '/ws', heartbeatInterval: 30000 })

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,

  adapters: [
    wsAdapter,
    new DevToolsAdapter({
      enabled: true,
      adapters: [wsAdapter],
    }),
    new SwaggerAdapter({
      adapters: [wsAdapter],
      info: {
        title: 'WebSocket Chat API',
        version: '1.0.0',
        description:
          'KickJS example with WebSocket chat, rooms, and notifications.\n\n' +
          '**Debug:** `/_debug/ws`, `/_debug/state`',
      },
    }),
  ],

  middleware: [requestId(), express.json({ limit: '1mb' })],
})
