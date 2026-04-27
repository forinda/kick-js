// kick/db typegen plugin — M2.B-T9.
//
// Reads the adopter's schema (a `src/db/schema.ts` file or `src/db/schema/`
// folder with a barrel index) and emits `.kickjs/types/kick__db.d.ts`
// containing two augmentations:
//
//   1. A global `KickDbSchema` interface set to `SchemaToKysely<typeof
//      appSchema>` — TS computes the column-level shape at type-check time
//      from the imported schema; no runtime cost, no manual mirroring.
//   2. A `KickDbRegister` augmentation pointing `db` at
//      `KickDbClient<KickDbSchema>`, so consumers of bare `KickDbClient`
//      widen automatically.
//
// Adopters who used to hand-write `src/db/register.ts` (M2.A-T6) can
// delete that file once this plugin emits the equivalent augmentation.

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
      `import type { SchemaToKysely, KickDbClient } from '@forinda/kickjs-db'`,
      `import type * as appSchema from '${rel}'`,
      ``,
      `declare global {`,
      `  interface KickDbSchema extends SchemaToKysely<typeof appSchema> {}`,
      `}`,
      ``,
      `declare module '@forinda/kickjs-db' {`,
      `  interface KickDbRegister {`,
      `    db: KickDbClient<KickDbSchema>`,
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
