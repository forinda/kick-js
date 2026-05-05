// kick/db typegen plugin — M2.B-T9 + M3.A.7.
//
// Reads the adopter's schema (a `src/db/schema.ts` file or `src/db/schema/`
// folder with a barrel index) and emits `.kickjs/types/kick__db.d.ts`
// containing three augmentations:
//
//   1. A global `KickDbSchema` interface set to `SchemaToTypes<typeof
//      appSchema>` — TS computes the column-level shape at type-check time
//      from the imported schema; no runtime cost, no manual mirroring.
//   2. A `KickDbRegister` augmentation pointing `db` at
//      `KickDbClient<KickDbSchema>`, so consumers of bare `KickDbClient`
//      widen automatically.
//   3. A `KickDbRelationsRegister` augmentation pointing `db` at
//      `SchemaToRelationsRegister<typeof appSchema>` — derives the
//      relation graph from the schema's `relations()` declarations so
//      `db.query.X.findMany({ with })` call sites get typed `with`
//      keys without a hand-rolled file.
//
// Adopters who used to hand-write `src/db/register.ts` (M2.A-T6) or
// `src/db/relations-register.ts` (M3.A.5 stop-gap) can delete both
// files once this plugin runs.

import path from 'node:path'
import { existsSync } from 'node:fs'

import type { TypegenPlugin } from '../plugin'

const DEFAULT_SCHEMA_PATHS = [
  'src/db/schema.ts',
  'src/db/schema/index.ts',
  'src/db/schema',
] as const

export const kickDbTypegen = (): TypegenPlugin => ({
  id: 'kick/db',
  inputs: ['src/db/schema.ts', 'src/db/schema/**/*.ts'],
  async generate(ctx) {
    const schemaAbs = resolveSchema(ctx.cwd)
    if (!schemaAbs) return null

    // Strip the `.ts` extension and any trailing `/index` so the import
    // specifier stays stable across single-file vs barrel-folder layouts —
    // TS resolves both forms identically.
    const typesDir = path.resolve(ctx.cwd, '.kickjs/types')
    const rel = posix(path.relative(typesDir, schemaAbs))
      .replace(/\.ts$/, '')
      .replace(/\/index$/, '')

    return [
      `import type { SchemaToTypes, SchemaToRelationsRegister, KickDbClient } from '@forinda/kickjs-db'`,
      `import type * as appSchema from '${rel}'`,
      ``,
      `declare global {`,
      `  interface KickDbSchema extends SchemaToTypes<typeof appSchema> {}`,
      `}`,
      ``,
      `declare module '@forinda/kickjs-db' {`,
      `  interface KickDbRegister {`,
      `    db: KickDbClient<KickDbSchema>`,
      `  }`,
      ``,
      `  interface KickDbRelationsRegister {`,
      `    db: SchemaToRelationsRegister<typeof appSchema>`,
      `  }`,
      `}`,
    ].join('\n')
  },
})

function resolveSchema(cwd: string): string | null {
  for (const candidate of DEFAULT_SCHEMA_PATHS) {
    const abs = path.resolve(cwd, candidate)
    if (candidate.endsWith('.ts')) {
      if (existsSync(abs)) return abs
    } else {
      // folder — look for an index.ts barrel
      const idx = path.join(abs, 'index.ts')
      if (existsSync(idx)) return idx
    }
  }
  return null
}

function posix(p: string): string {
  return p.replace(/\\/g, '/')
}
