// kickjs-db ↔ KickDevtoolsEventRegistry augmentation.
//
// Importing this file is a side effect — it adds the kickjs-db event
// shapes to `KickDevtoolsEventRegistry` so adopters who pair the bus
// with the typed `on()` overload get strict payloads at the call site:
//
//   import '@forinda/kickjs-db/devtools-events'  // side-effect import
//
//   bus.on('db:slow-query', (q) => {
//     // q: { sql, parameters, durationMs, thresholdMs }
//   })
//
// Why a separate file: kickjs-devtools-kit is an optional peer. If
// adopters skip devtools, they can skip this import too — saving the
// type-resolution round trip when the augmentation target doesn't
// exist. Adopters who DO have devtools-kit installed import this
// once (typically from `src/index.ts` of their app) to register the
// types globally.

import type { SlowQueryEvent, QueryErrorEvent } from './client/types'

declare module '@forinda/kickjs-devtools-kit/bus' {
  interface KickDevtoolsEventRegistry {
    /** Fired when a query duration exceeds `slowQueryThresholdMs`. */
    'db:slow-query': SlowQueryEvent
    /** Fired when a query throws — mirrors the local `queryError` event. */
    'db:query-error': QueryErrorEvent
    /**
     * Fired by `kickDbAdapter` after `migrationsOnBoot: 'apply'` runs
     * `migrateLatest()` on boot. `applied` is the list of migration
     * ids the runner just ran; `batch` is the journal batch number.
     */
    'db:migration-applied': { applied: string[]; batch: number | null }
  }
}

// Module augmentation requires at least one export so TS treats the
// file as a module. An empty `export {}` keeps the export surface
// closed.
export {}
