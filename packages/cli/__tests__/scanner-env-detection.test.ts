/**
 * Unit tests for `detectEnvFile` — the heuristic that picks the
 * adopter's env schema file out of a handful of candidate locations.
 *
 * Schema-detection lives in regex space because the scanner refuses to
 * evaluate adopter code (security + bootstrap cost). The trade-off is
 * that the regex MUST reject every `default-export-is-the-parsed-env`
 * shape; if any slip through, the generator runs the parsed env value
 * through `InferSchemaOutput` and emits a `KickEnv` whose member set
 * is the literal env data type instead of the schema's output shape.
 *
 * @module @forinda/kickjs-cli/__tests__/scanner-env-detection
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectEnvFile } from '../src/typegen/scanner'

describe('detectEnvFile', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'env-detect-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  const writeEnvFile = (relPath: string, contents: string): void => {
    const abs = join(cwd, relPath)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, contents, 'utf-8')
  }

  it('accepts a defineEnv default export (legacy scaffold)', async () => {
    writeEnvFile(
      'src/env.ts',
      `import { defineEnv } from '@forinda/kickjs/config'
import { z } from 'zod'
export default defineEnv((base) => base.extend({ FOO: z.string() }))
`,
    )
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).not.toBeNull()
    expect(result?.relativePath).toBe('src/env.ts')
  })

  it('accepts a fromZod default export (kickjs-schema scaffold)', async () => {
    writeEnvFile(
      'src/config/index.ts',
      `import { fromZod } from '@forinda/kickjs-schema/zod'
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { z } from 'zod'

const envSchema = fromZod(z.object({ FOO: z.string() }))
export const env = loadEnvFromSchema(envSchema)
export default envSchema
`,
    )
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).not.toBeNull()
    expect(result?.relativePath).toBe('src/config/index.ts')
  })

  it('accepts a fromValibot default export', async () => {
    writeEnvFile(
      'src/env.ts',
      `import { fromValibot } from '@forinda/kickjs-schema/valibot'
import * as v from 'valibot'
const envSchema = fromValibot(v.object({ FOO: v.string() }))
export default envSchema
`,
    )
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).not.toBeNull()
  })

  it('REJECTS a file whose default export is loadEnvFromSchema(...)', async () => {
    // This is the anti-pattern that the heuristic must reject. Even
    // though the file calls `fromZod(...)` (a schema constructor),
    // the default export is the parsed env *value*, not the schema —
    // running that through `InferSchemaOutput` would emit a broken
    // KickEnv augmentation.
    writeEnvFile(
      'src/env.ts',
      `import { fromZod } from '@forinda/kickjs-schema/zod'
import { loadEnvFromSchema } from '@forinda/kickjs/config'
import { z } from 'zod'

const schema = fromZod(z.object({ FOO: z.string() }))
export default loadEnvFromSchema(schema)
`,
    )
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).toBeNull()
  })

  it('REJECTS a file that calls loadEnvFromSchema but has no schema construction', async () => {
    // A consumer importing the schema from elsewhere and only calling
    // `loadEnvFromSchema(importedSchema)` here has no local schema to
    // generate types from. Skip silently — the actual schema file
    // (wherever it lives) gets detected separately.
    writeEnvFile(
      'src/env.ts',
      `import { loadEnvFromSchema } from '@forinda/kickjs/config'
import schemaFromElsewhere from './schemas/env-schema'

export const env = loadEnvFromSchema(schemaFromElsewhere)
export default env
`,
    )
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).toBeNull()
  })

  it('REJECTS a file without a default export', async () => {
    writeEnvFile(
      'src/env.ts',
      `import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'
export const envSchema = fromZod(z.object({ FOO: z.string() }))
`,
    )
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).toBeNull()
  })

  it('REJECTS a file that has no schema-construction call', async () => {
    writeEnvFile('src/env.ts', `export default 'not-a-schema'\n`)
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).toBeNull()
  })

  it('walks the default candidate list when the caller passes the literal default path', async () => {
    // `'src/env.ts'` is the runtime default sentinel — the scanner
    // searches every entry in `DEFAULT_ENV_FILE_CANDIDATES` so newer
    // scaffolds at `src/config/index.ts` keep working without forcing
    // every project to set `typegen.envFile` explicitly.
    writeEnvFile(
      'src/config/index.ts',
      `import { fromZod } from '@forinda/kickjs-schema/zod'
import { z } from 'zod'
export default fromZod(z.object({ FOO: z.string() }))
`,
    )
    const result = await detectEnvFile(cwd, 'src/env.ts')
    expect(result).not.toBeNull()
    expect(result?.relativePath).toBe('src/config/index.ts')
  })
})
