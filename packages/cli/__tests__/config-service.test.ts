/**
 * E2E tests for the typed `ConfigService` / `loadEnv` / `getEnv` flow.
 *
 * The new typing layer makes the bare `ConfigService` consume the
 * `KickEnv` global from `kick typegen` directly — no need to call
 * `createConfigService(schema)` and pass the schema again. These
 * tests verify the full pipeline:
 *
 *   1. Project has `src/env.ts` with a `defineEnv(...)` schema.
 *   2. `kick typegen` populates `KickEnv`.
 *   3. `ConfigService.get('KNOWN_KEY')` returns the inferred type.
 *   4. `ConfigService.get('UNKNOWN')` is a tsc error.
 *   5. `loadEnv()` no-arg returns `KickEnv` (via the new overload).
 *   6. `getEnv('PORT')` no-arg returns `number` (Zod coerced).
 *   7. Back-compat: empty `KickEnv` accepts any string + falls back to T.
 *
 * @module @forinda/kickjs-cli/__tests__/config-service.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { cleanupFixture, createFixtureProject, runCli, runTsc, WORKSPACE_ROOT } from './helpers'

describe('typed ConfigService (KickEnv)', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('config-service')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  function writeEnvSchema() {
    mkdirSync(join(fixture, 'src'), { recursive: true })
    writeFileSync(
      join(fixture, 'src/env.ts'),
      `import { defineEnv } from '@forinda/kickjs-config'
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

  function linkConfigPackage() {
    const configPath = join(fixture, 'node_modules/@forinda/kickjs-config')
    if (!existsSync(configPath)) {
      const target = join(WORKSPACE_ROOT, 'packages/config')
      execSync(`ln -sf "${target}" "${configPath}"`)
    }
  }

  it('ConfigService.get is typed against KickEnv after typegen', () => {
    writeEnvSchema()
    linkConfigPackage()
    runCli(fixture, ['typegen'])

    writeFileSync(
      join(fixture, 'src/positive.ts'),
      `import { Service, Autowired } from '@forinda/kickjs'
import { ConfigService } from '@forinda/kickjs-config'

@Service()
export class DatabaseService {
  @Autowired() private readonly config!: ConfigService

  connect() {
    // KickEnv['DATABASE_URL'] → string
    const url: string = this.config.get('DATABASE_URL')
    // KickEnv['PORT'] → number (Zod-coerced from baseEnvSchema)
    const port: number = this.config.get('PORT')
    // KickEnv['JWT_SECRET'] → string
    const secret: string = this.config.get('JWT_SECRET')
    return { url, port, secret }
  }
}
`,
    )
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })

  it('ConfigService.get rejects unknown keys at compile time', () => {
    writeEnvSchema()
    linkConfigPackage()
    runCli(fixture, ['typegen'])

    writeFileSync(
      join(fixture, 'src/negative.ts'),
      `import { Service, Autowired } from '@forinda/kickjs'
import { ConfigService } from '@forinda/kickjs-config'

@Service()
export class BadService {
  @Autowired() private readonly config!: ConfigService

  bad() {
    return this.config.get('NOPE_NOT_IN_SCHEMA')
  }
}
`,
    )
    const tsc = runTsc(fixture)
    expect(tsc.exitCode).not.toBe(0)
    expect(tsc.stdout + tsc.stderr).toContain('NOPE_NOT_IN_SCHEMA')
  })

  it('ConfigService.getAll() returns Readonly<KickEnv>', () => {
    writeEnvSchema()
    linkConfigPackage()
    runCli(fixture, ['typegen'])

    writeFileSync(
      join(fixture, 'src/getall.ts'),
      `import { Service, Autowired } from '@forinda/kickjs'
import { ConfigService } from '@forinda/kickjs-config'

@Service()
export class AllService {
  @Autowired() private readonly config!: ConfigService

  dump() {
    const all = this.config.getAll()
    // Each known key resolves to its schema-inferred type
    const url: string = all.DATABASE_URL
    const port: number = all.PORT
    return { url, port }
  }
}
`,
    )
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })

  it('loadEnv() no-arg and getEnv(key) no-arg return KickEnv-typed values', () => {
    writeEnvSchema()
    linkConfigPackage()
    runCli(fixture, ['typegen'])

    writeFileSync(
      join(fixture, 'src/load.ts'),
      `import { loadEnv, getEnv } from '@forinda/kickjs-config'

// loadEnv() no-arg → KickEnv
const env = loadEnv()
const url: string = env.DATABASE_URL
const port: number = env.PORT

// getEnv() no-arg → KickEnv[K]
const port2: number = getEnv('PORT')
const secret: string = getEnv('JWT_SECRET')

export { url, port, port2, secret }
`,
    )
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })

  it('back-compat: empty KickEnv accepts any string in ConfigService.get', () => {
    linkConfigPackage()
    // No src/env.ts → KickEnv stays empty → any string is accepted.
    runCli(fixture, ['typegen'])

    writeFileSync(
      join(fixture, 'src/legacy.ts'),
      `import { Service, Autowired } from '@forinda/kickjs'
import { ConfigService } from '@forinda/kickjs-config'

@Service()
export class LegacyService {
  @Autowired() private readonly config!: ConfigService

  legacy() {
    // No schema → any string is accepted, returns any
    const a: any = this.config.get('SOME_LEGACY_KEY')
    // Explicit T generic still works for typed back-compat
    const b: string = this.config.get<string, string>('ANOTHER_KEY')
    return { a, b }
  }
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
