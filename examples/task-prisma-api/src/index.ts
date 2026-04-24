import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs'
import { modules } from './modules'
import { adapters, middleware, plugins } from './config'

export const app = await bootstrap({
  modules,
  adapters,
  plugins,
  middleware,
  apiPrefix: '/api',
  defaultVersion: 1,
})
