/**
 * Drift guard: a scaffolded project must be test-isolated out of the box.
 *
 * Under a test run KickJS reads `.env.test` INSTEAD of `.env` — no
 * layering, no fallback. That is opt-in, so a template that writes `.env`
 * and a vitest config but no `.env.test` ships the exact shape
 * `kick doctor` warns about, and the app's first test run prints the
 * backfill warning instead of being isolated. The generator has to
 * produce the file for the feature to reach anyone who didn't read the
 * docs.
 */
import { describe, it, expect } from 'vitest'

import {
  generateEnv,
  generateEnvTest,
  generateGitIgnore,
  generateVitestConfig,
} from '../src/generators/templates/project-config'

describe('scaffolded .env.test', () => {
  it('declares the base-schema vars the suite needs', () => {
    const env = generateEnvTest()
    expect(env).toContain('NODE_ENV=test')
    // Port 0 = ask the OS for a free one, so a run cannot collide with a
    // dev server already holding the scaffolded 3000.
    expect(env).toContain('PORT=0')
    expect(env).not.toContain('PORT=3000')
  })

  it('is not a copy of .env — an omitted var must go missing, not inherit', () => {
    // The whole value of the short-circuit is that a var absent here is
    // absent at runtime. Mirroring every key back in rebuilds the trap.
    expect(generateEnvTest()).not.toBe(generateEnv())
    expect(generateEnv()).toContain('NODE_ENV=development')
  })

  it('warns against committing real credentials', () => {
    // It is a committed file, so the guidance has to be in the file.
    expect(generateEnvTest().toLowerCase()).toContain('credentials')
  })

  it('leaves the vitest config free of env pins', () => {
    // vitest `test.env` sets process.env before modules load, which
    // outranks every file — pins there would stop `.env.test` taking
    // effect at all.
    expect(generateVitestConfig()).not.toContain('env:')
  })

  it('gitignores *.local but keeps .env.test committed', () => {
    const ignore = generateGitIgnore()
    expect(ignore).toContain('*.local')
    // A bare `.env.test` line would defeat the point — the suite's
    // environment is meant to be shared and reviewable.
    expect(ignore.split('\n')).not.toContain('.env.test')
  })
})
