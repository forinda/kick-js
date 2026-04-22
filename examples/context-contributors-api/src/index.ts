import 'reflect-metadata'
import express from 'express'
import { bootstrap } from '@forinda/kickjs'
import { StartedAt } from './contributors'
import { FlagsAdapter } from './adapters/flags.adapter'
import { modules } from './modules'

/**
 * context-contributors-api — exercises every Context Contributor (#107)
 * registration site in one app.
 *
 *   global   → ApplicationOptions.contributors  (`StartedAt` below)
 *   adapter  → AppAdapter.contributors()        (`FlagsAdapter`)
 *   module   → AppModule.contributors()         (`ProjectsModule.contributors()`)
 *   class    → @LoadX on the controller class   (`@LoadTenant`)
 *   method   → @LoadX on a controller method    (`@LoadProject`)
 *
 * Hit `GET /api/v1/projects/p-1` and the response body shows what every
 * level produced. Hit `GET /api/v1/projects/` and you'll see the same
 * keys minus `project` (that one is method-scoped to `getOne`).
 */
export const app = await bootstrap({
  modules,
  adapters: [new FlagsAdapter()],
  contributors: [StartedAt.registration],
  middleware: [express.json()],
})
