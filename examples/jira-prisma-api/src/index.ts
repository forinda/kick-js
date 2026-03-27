import 'reflect-metadata'
import { bootstrap } from '@forinda/kickjs-http'
import { modules } from './modules'
import { adapters, middleware } from './config'

bootstrap({
  modules,
  adapters,
  middleware,
  apiPrefix: '/api',
  defaultVersion: 1,
})
