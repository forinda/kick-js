/**
 * E2E test for `kick g module` — generates a DDD module with the
 * default placeholder entity and verifies the result compiles.
 *
 * @module @forinda/kickjs-cli/__tests__/module.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli, runTsc } from './helpers'

describe('kick g module', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('module')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  it('generates a DDD module skeleton', () => {
    const result = runCli(fixture, ['g', 'module', 'task'])
    assertCliOk(result, 'kick g module task')

    const expectedFiles = [
      'src/modules/tasks/task.module.ts',
      'src/modules/tasks/constants.ts',
      'src/modules/tasks/presentation/task.controller.ts',
      'src/modules/tasks/application/dtos/create-task.dto.ts',
      'src/modules/tasks/application/dtos/update-task.dto.ts',
      'src/modules/tasks/application/dtos/task-response.dto.ts',
      'src/modules/tasks/application/use-cases/create-task.use-case.ts',
      'src/modules/tasks/application/use-cases/get-task.use-case.ts',
      'src/modules/tasks/application/use-cases/list-tasks.use-case.ts',
      'src/modules/tasks/application/use-cases/update-task.use-case.ts',
      'src/modules/tasks/application/use-cases/delete-task.use-case.ts',
      'src/modules/tasks/domain/repositories/task.repository.ts',
      'src/modules/tasks/domain/services/task-domain.service.ts',
      'src/modules/tasks/domain/entities/task.entity.ts',
      'src/modules/tasks/domain/value-objects/task-id.vo.ts',
      'src/modules/tasks/infrastructure/repositories/in-memory-task.repository.ts',
    ]
    for (const f of expectedFiles) {
      expect(existsSync(join(fixture, f)), `expected ${f} to exist`).toBe(true)
    }
  })

  it('auto-registers the module in src/modules/index.ts', () => {
    runCli(fixture, ['g', 'module', 'task'])
    const indexPath = join(fixture, 'src/modules/index.ts')
    expect(existsSync(indexPath)).toBe(true)
    const content = readFileSync(indexPath, 'utf-8')
    expect(content).toContain('TaskModule')
    expect(content).toContain("from './tasks/task.module'")
  })

  it('emits a collision-safe createToken for the repository token', () => {
    runCli(fixture, ['g', 'module', 'task'])

    const repoInterface = readFileSync(
      join(fixture, 'src/modules/tasks/domain/repositories/task.repository.ts'),
      'utf-8',
    )
    expect(repoInterface).toContain("import { createToken } from '@forinda/kickjs'")
    expect(repoInterface).toContain('createToken<ITaskRepository>(')
    expect(repoInterface).not.toContain("Symbol('ITaskRepository')")
  })

  it('passes tsc --noEmit', () => {
    runCli(fixture, ['g', 'module', 'task'])
    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\n${tsc.stdout}\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })

  it('handles multiple module names in one invocation', () => {
    const result = runCli(fixture, ['g', 'module', 'user', 'post'])
    assertCliOk(result, 'kick g module user post')

    expect(existsSync(join(fixture, 'src/modules/users/user.module.ts'))).toBe(true)
    expect(existsSync(join(fixture, 'src/modules/posts/post.module.ts'))).toBe(true)

    const indexContent = readFileSync(join(fixture, 'src/modules/index.ts'), 'utf-8')
    expect(indexContent).toContain('UserModule')
    expect(indexContent).toContain('PostModule')
  })
})
