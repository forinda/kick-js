import 'reflect-metadata'
// Side-effect import — registers the extended env schema with kickjs
// **before** any controller / service / @Value gets resolved.
import './config'

// Side-effect import — augments KickDbRelationsRegister so
// `db.query.X.findMany({ with })` call sites get typed `with` keys.
// Until the kick/db typegen plugin emits this side too, the file is
// hand-rolled per the relations() declarations in src/db/schema.
import './db/relations-register'

// KickDbClient widens automatically to the schema-derived shape via
// `.kickjs/types/kick__db.d.ts` (emitted by the kick/db typegen
// plugin). `kick dev` regenerates it on schema changes; `kick typegen`
// produces it once.

import { bootstrap, Container } from '@forinda/kickjs'
import { kickDbAdapter, DB_PRIMARY } from '@forinda/kickjs-db'

import { modules } from './modules'
import { dbClient, migrationAdapter, pool } from './db/client'

// Register the KickDbClient under DB_PRIMARY before bootstrap so any
// @Inject(DB_PRIMARY) resolution during module construction succeeds.
Container.getInstance().registerFactory(DB_PRIMARY, () => dbClient)

export const app = await bootstrap({
  modules,
  adapters: [
    kickDbAdapter({
      migrationAdapter,
      migrationsDir: 'db/migrations',
      // Default 'fail-if-pending' — operator must run `kick db migrate latest`
      // before deploying. 'apply' in dev so HMR-driven schema iteration is
      // ergonomic.
      migrationsOnBoot: process.env.NODE_ENV === 'development' ? 'apply' : 'fail-if-pending',
    }),
  ],
})

// Drain the pool when the process exits — kickDbAdapter.shutdown() is a
// no-op since the pool is shared with the query client.
process.on('SIGTERM', () => {
  void pool.end()
})
process.on('SIGINT', () => {
  void pool.end()
})
