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

    // Spot-check the file tree — flat REST layout.
    const expectedFiles = [
      'src/modules/widgets/widget.module.ts',
      'src/modules/widgets/widget.constants.ts',
      'src/modules/widgets/widget.controller.ts',
      'src/modules/widgets/widget.service.ts',
      'src/modules/widgets/dtos/create-widget.dto.ts',
      'src/modules/widgets/dtos/update-widget.dto.ts',
      'src/modules/widgets/dtos/widget-response.dto.ts',
      'src/modules/widgets/widget.repository.ts',
      'src/modules/widgets/in-memory-widget.repository.ts',
    ]
    for (const f of expectedFiles) {
      expect(existsSync(join(fixture, f)), `expected ${f} to exist`).toBe(true)
    }
  })

  it('propagates all field definitions through the create + response DTOs', () => {
    runCli(fixture, ['g', 'scaffold', 'widget', 'title:string', 'count:int', 'tags:json'])

    const createDto = readFileSync(
      join(fixture, 'src/modules/widgets/dtos/create-widget.dto.ts'),
      'utf-8',
    )
    expect(createDto).toContain('title: z.string()')
    expect(createDto).toContain('count: z.number().int()')
    expect(createDto).toContain('tags: z.any()')

    const responseDto = readFileSync(
      join(fixture, 'src/modules/widgets/dtos/widget-response.dto.ts'),
      'utf-8',
    )
    expect(responseDto).toContain('title: string')
    expect(responseDto).toContain('count: number')
    expect(responseDto).toContain('tags: any')

    // The repo builds the entity by spreading the create DTO, so it works
    // for any field set without hard-coding field names.
    const inMemoryRepo = readFileSync(
      join(fixture, 'src/modules/widgets/in-memory-widget.repository.ts'),
      'utf-8',
    )
    expect(inMemoryRepo).toContain('...dto')
  })

  it('emits a collision-safe createToken for the repository token', () => {
    runCli(fixture, ['g', 'scaffold', 'widget', 'title:string'])

    const repoInterface = readFileSync(
      join(fixture, 'src/modules/widgets/widget.repository.ts'),
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
    // is `{ path, controller }` — the framework derives the Express
    // Router from the controller via `buildRoutes()` internally so
    // the redundant `router:` field is no longer emitted.
    expect(moduleIndex).toContain("path: '/widgets'")
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

    // The post-typegen hook should have created .kickjs/types/kick__routes.ts
    expect(existsSync(join(fixture, '.kickjs/types/kick__routes.ts'))).toBe(true)

    const routes = readFileSync(join(fixture, '.kickjs/types/kick__routes.ts'), 'utf-8')
    expect(routes).toContain('namespace KickRoutes')
    expect(routes).toContain('interface WidgetController')
  })
})
