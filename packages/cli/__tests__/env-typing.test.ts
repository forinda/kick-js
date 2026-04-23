/**
 * E2E test for the typed env / `KickEnv` augmentation.
 *
 * Verifies the full pipeline:
 *   1. `src/env.ts` with a `defineEnv(...)` default export is detected
 *      by the scanner.
 *   2. `kick typegen` emits `.kickjs/types/env.ts` with a `KickEnv`
 *      and `NodeJS.ProcessEnv` augmentation derived from the schema.
 *   3. `@Value('KNOWN_KEY')` compiles, `@Value('UNKNOWN')` fails tsc.
 *   4. `process.env.KNOWN_KEY` is typed as `string`.
 *   5. Projects without `src/env.ts` keep accepting any string in
 *      `@Value` (back-compat).
 *
 * @module @forinda/kickjs-cli/__tests__/env-typing.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertCliOk,
  cleanupFixture,
  createFixtureProject,
  runCli,
  runTsc,
} from './helpers'

describe('typed env (KickEnv)', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('env-typing')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  function writeEnvSchema() {
    mkdirSync(join(fixture, 'src'), { recursive: true })
    writeFileSync(
      join(fixture, 'src/env.ts'),
      `import { defineEnv } from '@forinda/kickjs'
import { z } from 'zod'

export default defineEnv((base) =>
  base.extend({
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
  }),
)
`,
    )
  }

  it('emits .kickjs/types/env.ts when src/env.ts exists', () => {
    writeEnvSchema()

    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen')
    expect(result.stdout).toContain('env typed')

    const envFile = join(fixture, '.kickjs/types/env.ts')
    expect(existsSync(envFile)).toBe(true)
    const content = readFileSync(envFile, 'utf-8')
    expect(content).toContain('interface KickEnv extends _KickEnvShape')
    expect(content).toContain('namespace NodeJS')
    expect(content).toContain("from '../../src/env'")
  })

  it('skips env emission when src/env.ts does not exist', () => {
    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen (no env file)')
    expect(result.stdout).not.toContain('env typed')
    expect(existsSync(join(fixture, '.kickjs/types/env.ts'))).toBe(false)
  })

  it('skips env emission when src/env.ts exists but has no defineEnv', () => {
    mkdirSync(join(fixture, 'src'), { recursive: true })
    writeFileSync(join(fixture, 'src/env.ts'), `export default 'not-a-schema'\n`)

    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen (invalid env file)')
    expect(existsSync(join(fixture, '.kickjs/types/env.ts'))).toBe(false)
  })

  it('@Value compiles for known keys and rejects unknown ones', () => {
    writeEnvSchema()
    runCli(fixture, ['typegen'])

    // Positive case — known keys, with Env<K> type lookup
    writeFileSync(
      join(fixture, 'src/positive.ts'),
      `import { Service, Value, type Env } from '@forinda/kickjs'

@Service()
export class PositiveService {
  @Value('DATABASE_URL') readonly db!: Env<'DATABASE_URL'>
  @Value('JWT_SECRET') readonly secret!: Env<'JWT_SECRET'>
  @Value('PORT') readonly port!: Env<'PORT'>

  greet() {
    const url: string = this.db
    const port: number = this.port
    return { url, port }
  }
}
`,
    )
    const positive = runTsc(fixture)
    if (positive.exitCode !== 0) {
      throw new Error(`positive tsc failed:\n${positive.stdout}\n${positive.stderr}`)
    }
    expect(positive.exitCode).toBe(0)

    // Negative case — unknown key should be a tsc error.
    // Write it to a separate file and run tsc again.
    writeFileSync(
      join(fixture, 'src/negative.ts'),
      `import { Service, Value } from '@forinda/kickjs'

@Service()
export class NegativeService {
  @Value('UNKNOWN_KEY') readonly bad!: string
}
`,
    )
    const negative = runTsc(fixture)
    expect(negative.exitCode).not.toBe(0)
    expect(negative.stdout + negative.stderr).toContain('UNKNOWN_KEY')
  })

  it('process.env.KNOWN_KEY is typed as string', () => {
    writeEnvSchema()
    runCli(fixture, ['typegen'])

    writeFileSync(
      join(fixture, 'src/probe.ts'),
      `// process.env.DATABASE_URL should narrow to string (not string | undefined)
const url: string = process.env.DATABASE_URL
export { url }
`,
    )
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })

  it('back-compat: empty KickEnv accepts any string in @Value', () => {
    // No src/env.ts written. KickEnv stays empty, EnvKey is `never`,
    // and the conditional constraint accepts any literal.
    runCli(fixture, ['typegen'])
    writeFileSync(
      join(fixture, 'src/legacy.ts'),
      `import { Service, Value } from '@forinda/kickjs'

@Service()
export class LegacyService {
  @Value('SOME_LEGACY_KEY') readonly legacy!: string
  @Value('ANYTHING_GOES') readonly other!: string
}
`,
    )
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })
})
