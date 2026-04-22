import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { adapters, middleware } from './config'

export const app = await bootstrap({
  modules,
  adapters,
  middleware,
  apiPrefix: '/api',
  defaultVersion: 1,
})
