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
      info: {
        title: 'WebSocket Chat API',
        version: '1.0.0',
        description:
          'KickJS example with WebSocket chat, rooms, and notifications.\n\n' +
          '**WebSocket endpoints:**\n' +
          '- `ws://localhost:3000/ws/chat` — Chat with rooms\n' +
          '- `ws://localhost:3000/ws/notifications` — Pub/sub notifications\n\n' +
          '**Debug:**\n' +
          '- `GET /_debug/ws` — WebSocket stats\n' +
          '- `GET /_debug/state` — Full state including WS',
      },
    }),
  ],

  middleware: [requestId(), express.json({ limit: '1mb' })],
})
