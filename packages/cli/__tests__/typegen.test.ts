/**
 * E2E tests for `kick typegen` — covers the type generator's
 * end-to-end behaviour: registry / routes / collision detection.
 *
 * @module @forinda/kickjs-cli/__tests__/typegen.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli, runTsc } from './helpers'

describe('kick typegen', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('typegen')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  function writeController(path: string, content: string) {
    const full = join(fixture, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }

  it('produces all five generated files for a project with no controllers', () => {
    const result = runCli(fixture, ['typegen'])
    assertCliOk(result, 'kick typegen')
    for (const f of [
      '.kickjs/types/registry.d.ts',
      '.kickjs/types/services.d.ts',
      '.kickjs/types/modules.d.ts',
      '.kickjs/types/routes.ts',
      '.kickjs/types/index.d.ts',
      '.kickjs/.gitignore',
    ]) {
      expect(existsSync(join(fixture, f)), `${f}`).toBe(true)
    }
  })

  it('emits typed Ctx<KickRoutes...> entries from a real controller', () => {
    writeController(
      'src/users/user.controller.ts',
      `import { Controller, Get, Post } from '@forinda/kickjs'
import { z } from 'zod'

export const createUserSchema = z.object({ email: z.string().email() })

@Controller()
export class UserController {
  @Get('/:id')
  getById() {}

  @Post('/', { body: createUserSchema })
  create() {}
}
`,
    )

    runCli(fixture, ['typegen'])

    const routes = readFileSync(join(fixture, '.kickjs/types/routes.ts'), 'utf-8')
    expect(routes).toContain('namespace KickRoutes')
    expect(routes).toContain('interface UserController')
    expect(routes).toContain('getById:')
    expect(routes).toContain('create:')
    expect(routes).toContain('{ id: string }')
    // Body should be inferred from the Zod schema
    expect(routes).toContain("import('zod').infer<typeof _S")
  })

  it('hard-fails on token collisions by default', () => {
    writeController(
      'src/a/user.service.ts',
      `import { Service } from '@forinda/kickjs'
@Service()
export class UserService {}
`,
    )
    writeController(
      'src/b/user.service.ts',
      `import { Service } from '@forinda/kickjs'
@Service()
export class UserService {}
`,
    )

    const result = runCli(fixture, ['typegen'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('token collision')
    expect(result.stderr).toContain('UserService')
  })

  it('auto-namespaces colliding tokens with --allow-duplicates', () => {
    writeController(
      'src/a/user.service.ts',
      `import { Service } from '@forinda/kickjs'
@Service()
export class UserService {}
`,
    )
    writeController(
      'src/b/user.service.ts',
      `import { Service } from '@forinda/kickjs'
@Service()
export class UserService {}
`,
    )

    const result = runCli(fixture, ['typegen', '--allow-duplicates'])
    assertCliOk(result, 'kick typegen --allow-duplicates')

    const registry = readFileSync(join(fixture, '.kickjs/types/registry.d.ts'), 'utf-8')
    // Both colliding entries should be namespaced
    expect(registry).toContain("'a/UserService'")
    expect(registry).toContain("'b/UserService'")
  })

  it('produces a tsc-clean output for a real controller + Zod schema', () => {
    writeController(
      'src/users/dto.ts',
      `import { z } from 'zod'
export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
})
`,
    )
    writeController(
      'src/users/user.controller.ts',
      `import { Controller, Post, type Ctx } from '@forinda/kickjs'
import { createUserSchema } from './dto'

@Controller()
export class UserController {
  @Post('/', { body: createUserSchema })
  async create(ctx: Ctx<KickRoutes.UserController['create']>) {
    // ctx.body should be typed { email: string; name: string }
    return { id: 1, email: ctx.body.email, name: ctx.body.name }
  }
}
`,
    )

    runCli(fixture, ['typegen'])
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })
})
