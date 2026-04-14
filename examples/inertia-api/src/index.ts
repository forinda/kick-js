import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bootstrap } from '@forinda/kickjs-http'
import { InertiaAdapter, defineInertiaConfig } from '@forinda/kickjs-inertia'
import { modules } from './modules'

const rootView = readFileSync(resolve('src/app.html'), 'utf-8')

const inertiaConfig = defineInertiaConfig({
  rootView,
  share: async () => ({
    app: { name: 'KickJS Inertia Example' },
  }),
})

bootstrap({
  modules,
  adapters: [new InertiaAdapter(inertiaConfig)],
})
