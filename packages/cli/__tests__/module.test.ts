/**
 * E2E test for `kick g module` — generates a DDD module with the
 * default placeholder entity and verifies the result compiles.
 *
 * @module @forinda/kickjs-cli/__tests__/module.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

  it('emits the defineModule factory by default', () => {
    runCli(fixture, ['g', 'module', 'task'])
    const moduleFile = readFileSync(join(fixture, 'src/modules/tasks/task.module.ts'), 'utf-8')
    expect(moduleFile).toContain("import { defineModule } from '@forinda/kickjs'")
    expect(moduleFile).toContain('export const TaskModule = defineModule({')
    expect(moduleFile).toContain("name: 'TaskModule'")
    expect(moduleFile).not.toContain('implements AppModule')

    // The orchestrator emits the fluent `defineModules()` chain by
    // default. New projects start with `defineModules().mount(X())`
    // so subsequent `kick g module` invocations append cleanly.
    const indexContent = readFileSync(join(fixture, 'src/modules/index.ts'), 'utf-8')
    expect(indexContent).toContain("import { defineModules } from '@forinda/kickjs'")
    expect(indexContent).toContain('defineModules().mount(TaskModule())')
  })

  it('appends to an existing defineModules() chain on subsequent generations', () => {
    runCli(fixture, ['g', 'module', 'user'])
    runCli(fixture, ['g', 'module', 'task'])
    const indexContent = readFileSync(join(fixture, 'src/modules/index.ts'), 'utf-8')
    // First module establishes the chain; second one is appended via
    // `.mount(TaskModule())` on a new line. This is the regression
    // guard for the fluent-chain orchestrator path — flat-array
    // detection was the legacy behaviour.
    expect(indexContent).toContain('.mount(UserModule())')
    expect(indexContent).toContain('.mount(TaskModule())')
  })

  it('does not skip generation when a longer module name already contains the new name as a substring', () => {
    // Regression: previously `content.includes(\`${pascal}Module\`)` was
    // a bare substring check, so generating `Item` would think
    // `OrderItemModule` already implied an import. With a word-boundary
    // check, generating `Item` alongside `OrderItem` produces both
    // imports + both `.mount(...)` entries.
    runCli(fixture, ['g', 'module', 'order-item'])
    runCli(fixture, ['g', 'module', 'item'])
    const indexContent = readFileSync(join(fixture, 'src/modules/index.ts'), 'utf-8')
    expect(indexContent).toMatch(/import \{ OrderItemModule \}/)
    expect(indexContent).toMatch(/import \{ ItemModule \}/)
    expect(indexContent).toContain('.mount(OrderItemModule())')
    expect(indexContent).toContain('.mount(ItemModule())')
  })

  it('the balanced-paren scanner skips comments — `)` inside `//` or `/* */` does not break the chain walk', () => {
    // Regression: previously balancedClose() didn't skip comments,
    // so a stray `)` inside a comment terminated the scan early
    // and the next append landed in the wrong place. Hand-craft a
    // registry with a comment containing parens, then run
    // `kick g module` and confirm the new module lands at the
    // right spot.
    runCli(fixture, ['g', 'module', 'hello'])
    const indexPath = join(fixture, 'src/modules/index.ts')
    const original = readFileSync(indexPath, 'utf-8')
    writeFileSync(
      indexPath,
      original.replace(
        '.mount(HelloModule())',
        '.mount(/* a (comment with parens) and ) inside */ HelloModule())',
      ),
    )

    runCli(fixture, ['g', 'module', 'task'])
    const updated = readFileSync(indexPath, 'utf-8')
    // Comment preserved; new module appended after the existing chain.
    expect(updated).toContain('comment with parens')
    expect(updated).toContain('.mount(TaskModule())')
    // The order is hello → task; new entry doesn't land mid-comment.
    expect(updated.indexOf('HelloModule')).toBeLessThan(updated.indexOf('TaskModule'))
  })

  it('mutates the export const modules declaration, not unrelated builders earlier in the file', () => {
    // Regression: `appendModuleEntry` previously matched the first
    // `[...]` or `defineModules(...)` anywhere in the file. Helper
    // arrays declared above the registry got mutated instead of the
    // `export const modules`. Now anchored on the declaration.
    runCli(fixture, ['g', 'module', 'user'])
    const indexPath = join(fixture, 'src/modules/index.ts')
    const original = readFileSync(indexPath, 'utf-8')
    // Inject a sibling array that the old anchor-anywhere logic would
    // have rewritten.
    writeFileSync(
      indexPath,
      `import type { Helper } from 'somewhere'\n` +
        `const helpers: Helper[] = ['unrelated']\n` +
        original,
    )

    runCli(fixture, ['g', 'module', 'task'])
    const updated = readFileSync(indexPath, 'utf-8')
    // Helper array stays untouched.
    expect(updated).toContain(`const helpers: Helper[] = ['unrelated']`)
    // TaskModule lands on the actual modules registry.
    expect(updated).toContain('.mount(TaskModule())')
  })
})

describe('kick g module — style-drift gate', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('module-style-gate')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  it('refuses to generate when style="define" but class-form modules exist', () => {
    // Drop a class-form module into the project, then try to add a
    // new module while style defaults to 'define'. The gate should
    // refuse with a pointer to `kick codemod modules`.
    const legacyDir = join(fixture, 'src/modules/users')
    require('node:fs').mkdirSync(legacyDir, { recursive: true })
    writeFileSync(
      join(legacyDir, 'user.module.ts'),
      `import { type AppModule, type ModuleRoutes } from '@forinda/kickjs'

export class UserModule implements AppModule {
  routes(): ModuleRoutes {
    return null as never
  }
}
`,
    )

    const result = runCli(fixture, ['g', 'module', 'task'])
    expect(result.exitCode).not.toBe(0)
    const combined = `${result.stdout}\n${result.stderr}`
    expect(combined).toMatch(/legacy.*class.*AppModule.*shape/i)
    expect(combined).toContain('kick codemod modules')
    expect(combined).toMatch(/style:\s*'class'/)
  })

  it('proceeds when style="class" is set, even with class-form modules', () => {
    // Pin to class form — the gate is skipped.
    writeFileSync(
      join(fixture, 'kick.config.json'),
      JSON.stringify({ pattern: 'ddd', modules: { style: 'class' } }),
    )

    const legacyDir = join(fixture, 'src/modules/users')
    require('node:fs').mkdirSync(legacyDir, { recursive: true })
    writeFileSync(
      join(legacyDir, 'user.module.ts'),
      `import { type AppModule, type ModuleRoutes } from '@forinda/kickjs'

export class UserModule implements AppModule {
  routes(): ModuleRoutes {
    return null as never
  }
}
`,
    )

    const result = runCli(fixture, ['g', 'module', 'task'])
    assertCliOk(result, 'kick g module task (style: class with legacy)')
    expect(existsSync(join(fixture, 'src/modules/tasks/task.module.ts'))).toBe(true)
  })
})

describe("kick g module — modules.style: 'class' opt-out", () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('module-style-class')
    // Pin the project to the legacy class form before generating.
    // JSON config avoids needing `@forinda/kickjs-cli` resolution in
    // the temp fixture; the loader handles `kick.config.json` the
    // same as a TS config file.
    writeFileSync(
      join(fixture, 'kick.config.json'),
      JSON.stringify({ pattern: 'ddd', modules: { style: 'class' } }, null, 2),
    )
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  it('emits class FooModule implements AppModule when style is "class"', () => {
    runCli(fixture, ['g', 'module', 'task'])
    const moduleFile = readFileSync(join(fixture, 'src/modules/tasks/task.module.ts'), 'utf-8')
    expect(moduleFile).toContain('export class TaskModule implements AppModule {')
    expect(moduleFile).toContain('register(container: Container): void {')
    expect(moduleFile).toContain('routes(): ModuleRoutes {')
    // Should NOT contain the factory-form noise.
    expect(moduleFile).not.toContain('defineModule({')
  })

  it('inserts the bare class reference (no factory call) into src/modules/index.ts', () => {
    runCli(fixture, ['g', 'module', 'task'])
    const indexContent = readFileSync(join(fixture, 'src/modules/index.ts'), 'utf-8')
    expect(indexContent).toContain('[TaskModule]')
    expect(indexContent).not.toContain('[TaskModule()]')
  })
})
