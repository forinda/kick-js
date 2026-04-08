/**
 * E2E tests for the small commands that don't fit elsewhere:
 *  - kick rm module
 *  - kick g config
 *  - kick info
 *
 * @module @forinda/kickjs-cli/__tests__/misc.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli } from './helpers'

describe('misc commands', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('misc')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  describe('kick rm module', () => {
    it('removes a previously generated module and updates the index', () => {
      runCli(fixture, ['g', 'module', 'task'])
      expect(existsSync(join(fixture, 'src/modules/tasks'))).toBe(true)

      const result = runCli(fixture, ['rm', 'module', 'task', '--force'])
      assertCliOk(result, 'kick rm module task')

      expect(existsSync(join(fixture, 'src/modules/tasks'))).toBe(false)

      // index.ts should no longer reference TaskModule
      const indexPath = join(fixture, 'src/modules/index.ts')
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8')
        expect(content).not.toContain('TaskModule')
      }
    })
  })

  describe('kick g config', () => {
    it('generates a kick.config.ts at the project root', () => {
      const result = runCli(fixture, ['g', 'config'])
      assertCliOk(result, 'kick g config')
      const file = join(fixture, 'kick.config.ts')
      expect(existsSync(file)).toBe(true)
      const content = readFileSync(file, 'utf-8')
      expect(content).toContain('defineConfig')
    })
  })

  describe('kick info', () => {
    it('exits successfully and prints framework info', () => {
      const result = runCli(fixture, ['info'])
      assertCliOk(result, 'kick info')
      // The output is human-readable; just sanity-check it isn't empty
      expect(result.stdout.length).toBeGreaterThan(0)
    })
  })
})
