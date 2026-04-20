/**
 * E2E test for `kick g scaffold` — generates a CRUD module from
 * field definitions and verifies the result compiles cleanly.
 *
 * This is the highest-leverage test in the suite because it would
 * have caught both bugs we just fixed:
 *   - HelloModule missing register() (would fail tsc + runtime)
 *   - scaffold's broken { prefix, controllers } shape (fails tsc)
 *
 * @module @forinda/kickjs-cli/__tests__/scaffold.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCliOk, cleanupFixture, createFixtureProject, runCli, runTsc } from './helpers'

describe('kick g scaffold', () => {
  let fixture: string

  beforeEach(() => {
    fixture = createFixtureProject('scaffold')
  })

  afterEach(() => {
    cleanupFixture(fixture)
  })

  it('generates a complete CRUD module from field definitions', () => {
    const result = runCli(fixture, [
      'g',
      'scaffold',
      'widget',
      'title:string',
      'body:text',
      'published:boolean',
    ])
    assertCliOk(result, 'kick g scaffold widget')

    // Spot-check the file tree — every layer of the DDD pattern.
    const expectedFiles = [
      'src/modules/widgets/widget.module.ts',
      'src/modules/widgets/constants.ts',
      'src/modules/widgets/presentation/widget.controller.ts',
      'src/modules/widgets/application/dtos/create-widget.dto.ts',
      'src/modules/widgets/application/dtos/update-widget.dto.ts',
      'src/modules/widgets/application/dtos/widget-response.dto.ts',
      'src/modules/widgets/application/use-cases/create-widget.use-case.ts',
      'src/modules/widgets/application/use-cases/get-widget.use-case.ts',
      'src/modules/widgets/application/use-cases/list-widgets.use-case.ts',
      'src/modules/widgets/application/use-cases/update-widget.use-case.ts',
      'src/modules/widgets/application/use-cases/delete-widget.use-case.ts',
      'src/modules/widgets/domain/repositories/widget.repository.ts',
      'src/modules/widgets/domain/services/widget-domain.service.ts',
      'src/modules/widgets/infrastructure/repositories/in-memory-widget.repository.ts',
      'src/modules/widgets/domain/entities/widget.entity.ts',
      'src/modules/widgets/domain/value-objects/widget-id.vo.ts',
    ]
    for (const f of expectedFiles) {
      expect(existsSync(join(fixture, f)), `expected ${f} to exist`).toBe(true)
    }
  })

  it('propagates all field definitions through the entity, DTO, and repository', () => {
    runCli(fixture, ['g', 'scaffold', 'widget', 'title:string', 'count:int', 'tags:json'])

    const entity = readFileSync(
      join(fixture, 'src/modules/widgets/domain/entities/widget.entity.ts'),
      'utf-8',
    )
    expect(entity).toContain('title: string')
    expect(entity).toContain('count: number')
    expect(entity).toContain('tags: any')

    const createDto = readFileSync(
      join(fixture, 'src/modules/widgets/application/dtos/create-widget.dto.ts'),
      'utf-8',
    )
    expect(createDto).toContain('title: z.string()')
    expect(createDto).toContain('count: z.number().int()')
    expect(createDto).toContain('tags: z.any()')

    const inMemoryRepo = readFileSync(
      join(
        fixture,
        'src/modules/widgets/infrastructure/repositories/in-memory-widget.repository.ts',
      ),
      'utf-8',
    )
    expect(inMemoryRepo).toContain('title: dto.title')
    expect(inMemoryRepo).toContain('count: dto.count')
    expect(inMemoryRepo).toContain('tags: dto.tags')
  })

  it('emits a collision-safe createToken for the repository token', () => {
    runCli(fixture, ['g', 'scaffold', 'widget', 'title:string'])

    const repoInterface = readFileSync(
      join(fixture, 'src/modules/widgets/domain/repositories/widget.repository.ts'),
      'utf-8',
    )
    // Repository token should use createToken<IWidgetRepository>(...) so
    // container.resolve(WIDGET_REPOSITORY) returns the typed interface,
    // not `any`. This is the project's standard hardening pattern.
    expect(repoInterface).toContain("import { createToken } from '@forinda/kickjs'")
    expect(repoInterface).toContain('createToken<IWidgetRepository>(')
    // The legacy Symbol() pattern must NOT appear
    expect(repoInterface).not.toContain("Symbol('IWidgetRepository')")
  })

  it('emits a module index with the correct ModuleRoutes shape', () => {
    runCli(fixture, ['g', 'scaffold', 'widget', 'title:string'])

    const moduleIndex = readFileSync(join(fixture, 'src/modules/widgets/widget.module.ts'), 'utf-8')
    // Regression: we previously emitted { prefix, controllers } which
    // was the legacy shape and broke the framework. The current shape
    // must include path/router/controller — verified by the assertions
    // below AND by the tsc test in the next case.
    expect(moduleIndex).toContain("path: '/widgets'")
    expect(moduleIndex).toContain('buildRoutes(WidgetController)')
    expect(moduleIndex).toContain('controller: WidgetController')
    // The legacy shape must NOT appear
    expect(moduleIndex).not.toContain('prefix:')
    expect(moduleIndex).not.toContain('controllers: [')
  })

  it('passes tsc --noEmit on the generated files', () => {
    runCli(fixture, ['g', 'scaffold', 'widget', 'title:string', 'body:text', 'published:boolean'])

    const tsc = runTsc(fixture)
    if (tsc.exitCode !== 0) {
      throw new Error(`tsc failed:\nstdout:\n${tsc.stdout}\nstderr:\n${tsc.stderr}`)
    }
    expect(tsc.exitCode).toBe(0)
  })

  it('auto-runs typegen so KickRoutes references resolve', () => {
    runCli(fixture, ['g', 'scaffold', 'widget', 'title:string'])

    // The post-typegen hook should have created .kickjs/types/routes.ts
    expect(existsSync(join(fixture, '.kickjs/types/routes.ts'))).toBe(true)

    const routes = readFileSync(join(fixture, '.kickjs/types/routes.ts'), 'utf-8')
    expect(routes).toContain('namespace KickRoutes')
    expect(routes).toContain('interface WidgetController')
  })
})
