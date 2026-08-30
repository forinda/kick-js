/**
 * E2E tests for the smaller leaf generators that produce a single
 * file (or a small handful) without orchestrating a whole module.
 *
 * @module @forinda/kickjs-cli/__tests__/leaf-generators.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli, runTsc } from './helpers'

describe('kick g <leaf>', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('leaf')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  describe('controller', () => {
    it('generates a standalone @Controller class', () => {
      const result = runCli(fixture, ['g', 'controller', 'auth'])
      assertCliOk(result, 'kick g controller auth')
      const file = join(fixture, 'src/controllers/auth.controller.ts')
      expect(existsSync(file)).toBe(true)
      const content = readFileSync(file, 'utf-8')
      expect(content).toContain('@Controller()')
      expect(content).toContain('class AuthController')
      // Templates use Ctx<KickRoutes...> from Phase A
      expect(content).toContain('Ctx<KickRoutes.AuthController')
    })

    it('passes tsc --noEmit', () => {
      runCli(fixture, ['g', 'controller', 'auth'])
      const tsc = runTsc(fixture)
      if (tsc.exitCode !== 0) {
        throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
      }
      expect(tsc.exitCode).toBe(0)
    })
  })

  describe('service', () => {
    it('generates a @Service singleton', () => {
      const result = runCli(fixture, ['g', 'service', 'payment'])
      assertCliOk(result, 'kick g service payment')
      const file = join(fixture, 'src/services/payment.service.ts')
      expect(existsSync(file)).toBe(true)
      const content = readFileSync(file, 'utf-8')
      expect(content).toContain('@Service()')
      expect(content).toContain('class PaymentService')
    })

    it('passes tsc --noEmit', () => {
      runCli(fixture, ['g', 'service', 'payment'])
      const tsc = runTsc(fixture)
      if (tsc.exitCode !== 0) {
        throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
      }
      expect(tsc.exitCode).toBe(0)
    })
  })

  describe('middleware', () => {
    it('generates an Express middleware function', () => {
      const result = runCli(fixture, ['g', 'middleware', 'logger'])
      assertCliOk(result, 'kick g middleware logger')
      const file = join(fixture, 'src/middleware/logger.middleware.ts')
      expect(existsSync(file)).toBe(true)
    })

    it('passes tsc --noEmit', () => {
      runCli(fixture, ['g', 'middleware', 'logger'])
      const tsc = runTsc(fixture)
      if (tsc.exitCode !== 0) {
        throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
      }
      expect(tsc.exitCode).toBe(0)
    })
  })

  describe('guard', () => {
    it('generates a route guard middleware', () => {
      const result = runCli(fixture, ['g', 'guard', 'admin'])
      assertCliOk(result, 'kick g guard admin')
      const file = join(fixture, 'src/guards/admin.guard.ts')
      expect(existsSync(file)).toBe(true)
    })

    it('passes tsc --noEmit', () => {
      runCli(fixture, ['g', 'guard', 'admin'])
      const tsc = runTsc(fixture)
      if (tsc.exitCode !== 0) {
        throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
      }
      expect(tsc.exitCode).toBe(0)
    })
  })

  describe('dto', () => {
    it('generates a Zod DTO schema', () => {
      const result = runCli(fixture, ['g', 'dto', 'create-user'])
      assertCliOk(result, 'kick g dto create-user')
      const file = join(fixture, 'src/dtos/create-user.dto.ts')
      expect(existsSync(file)).toBe(true)
      const content = readFileSync(file, 'utf-8')
      expect(content).toContain("from 'zod'")
    })

    it('passes tsc --noEmit', () => {
      runCli(fixture, ['g', 'dto', 'create-user'])
      const tsc = runTsc(fixture)
      if (tsc.exitCode !== 0) {
        throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
      }
      expect(tsc.exitCode).toBe(0)
    })
  })
})
