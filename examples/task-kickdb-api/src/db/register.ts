// Register the typed KickDbClient globally via the KickDbRegister
// augmentation so `KickDbClient` (with no explicit generic) widens to
// `typeof dbClient` everywhere it's used — repositories don't need to
// import `Db` and cast.
//
// Imported as a side effect from src/index.ts so the augmentation is in
// scope before any module touches `KickDbClient`.
//
// NOTE: this file becomes redundant once `kick typegen` runs and emits
// `.kickjs/types/kick__db.d.ts` (the kick/db plugin from M2.B-T9).
// Delete it then; the generated augmentation is equivalent.

import type { dbClient } from './client'

declare module '@forinda/kickjs-db' {
  interface KickDbRegister {
    db: typeof dbClient
  }
}
