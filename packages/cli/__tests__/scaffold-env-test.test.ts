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
  generateEnvTestExample,
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

  it('warns against putting real credentials in the committed template', () => {
    // Its keys are mirrored into the committed .env.test.example, so the
    // guidance has to be in the file.
    expect(generateEnvTest().toLowerCase()).toContain('credentials')
  })

  it('leaves the vitest config free of env pins', () => {
    // vitest `test.env` sets process.env before modules load, which
    // outranks every file — pins there would stop `.env.test` taking
    // effect at all.
    expect(generateVitestConfig()).not.toContain('env:')
  })

  it('gitignores .env.test and *.local; the committed template is .env.test.example', () => {
    // Values differ per machine; a tracked .env.test turns every local
    // tweak into a diff (and a conflict) for the whole team.
    const ignore = generateGitIgnore().split('\n')
    expect(ignore).toContain('.env.test')
    expect(ignore).toContain('*.local')
    expect(ignore).not.toContain('.env.test.example')
  })

  it('ships a .env.test.example with the same keys and copy instructions', () => {
    const example = generateEnvTestExample()
    expect(example).toContain('cp .env.test.example .env.test')
    expect(example).toContain(generateEnvTest())
  })
})
