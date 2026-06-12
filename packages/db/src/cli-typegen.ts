/**
 * `kick/db` typegen — reads the adopter's schema (`src/db/schema.ts` or a
 * `src/db/schema/` barrel) and emits `.kickjs/types/kick__db.d.ts` with
 * three augmentations:
 *
 *   1. global `KickDbSchema = SchemaToTypes<typeof appSchema>` — column
 *      shapes computed at type-check time, no runtime cost.
 *   2. `KickDbRegister.db = KickDbClient<KickDbSchema>` — bare
 *      `KickDbClient` widens automatically.
 *   3. `KickDbRelationsRegister.db = SchemaToRelationsRegister<typeof
 *      appSchema>` — typed `with` keys for `db.query.X.findMany`.
 *
 * Shipped on {@link dbCliPlugin} (`typegens`) so mounting the db plugin
 * brings both the `kick db` commands and this type generation. Typed
 * against the `@forinda/kickjs-cli-kit` `CliTypegen` contract so it needs
 * no kickjs-cli internals — it only reads `ctx.cwd`.
 */
import path from 'node:path'
import { existsSync } from 'node:fs'

import type { CliTypegen } from '@forinda/kickjs-cli-kit'

const DEFAULT_SCHEMA_PATHS = [
  'src/db/schema.ts',
  'src/db/schema/index.ts',
  'src/db/schema',
] as const

export const kickDbTypegen = (): CliTypegen => ({
  id: 'kick/db',
  inputs: ['src/db/schema.ts', 'src/db/schema/**/*.ts'],
  async generate(ctx: { cwd: string; config?: { db?: { schemaPath?: string } } }) {
    // Parity with `kick db generate` (cli/config.ts resolveDbConfig):
    // an adopter-configured `db.schemaPath` must drive BOTH the
    // migration engine and this augmentation — previously only the
    // default candidates were probed, so a custom path produced
    // working migrations but a silently untyped client.
    const schemaAbs = resolveSchema(ctx.cwd, ctx.config?.db?.schemaPath)
    if (!schemaAbs) return null

    // Strip the `.ts` extension and any trailing `/index` so the import
    // specifier stays stable across single-file vs barrel-folder layouts.
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

function resolveSchema(cwd: string, configuredPath?: string): string | null {
  // kick.config `db.schemaPath` wins when the file exists; a configured-
  // but-missing path falls through to the candidates rather than
  // emitting an augmentation with a broken import specifier.
  if (configuredPath) {
    const abs = path.resolve(cwd, configuredPath)
    if (existsSync(abs)) return abs
    const idx = path.join(abs, 'index.ts')
    if (existsSync(idx)) return idx
  }
  for (const candidate of DEFAULT_SCHEMA_PATHS) {
    const abs = path.resolve(cwd, candidate)
    if (candidate.endsWith('.ts')) {
      if (existsSync(abs)) return abs
    } else {
      const idx = path.join(abs, 'index.ts')
      if (existsSync(idx)) return idx
    }
  }
  return null
}

function posix(p: string): string {
  return p.replace(/\\/g, '/')
}
