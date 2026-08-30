/**
 * `@ApiTags` comes from `@forinda/kickjs-swagger`. Emitting it for a project
 * that does not depend on that package writes a controller which cannot
 * compile — an unresolvable import plus five decorators, in a file the adopter
 * did not write and did not ask for.
 *
 * Same class as the `lint: 'eslint src/'` script that shipped without eslint
 * ever being a dependency: generated output referring to something the project
 * does not have.
 *
 * @module @forinda/kickjs-cli/__tests__/generator-swagger-gate.test
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateController, generateRestController } from '../src/generators/templates/controller'
import { hasDependency, hasSwagger } from '../src/config'

const ctx = { pascal: 'Product', kebab: 'product', plural: 'products', pluralPascal: 'Products' }

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function projectWith(pkg: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'kick-swagger-'))
  dirs.push(dir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', ...pkg }))
  return dir
}

describe('swagger gate', () => {
  it('emits no ApiTags when the project does not depend on swagger', () => {
    for (const out of [generateController(ctx), generateRestController(ctx)]) {
      expect(out).not.toContain('@forinda/kickjs-swagger')
      expect(out).not.toContain('ApiTags')
    }
  })

  it('emits ApiTags and its import when it does', () => {
    for (const out of [
      generateController({ ...ctx, swagger: true }),
      generateRestController({ ...ctx, swagger: true }),
    ]) {
      expect(out).toContain("import { ApiTags } from '@forinda/kickjs-swagger'")
      expect(out).toContain("@ApiTags('Product')")
    }
  })

  it('leaves the decorator stack well-formed either way', () => {
    // Dropping a decorator line must not leave a gap between `@Get` and the
    // decorator under it, or a dangling blank line before the method.
    const without = generateController(ctx)
    expect(without).toContain("@Get('/')\n  @ApiQueryParams(")
    expect(without).not.toMatch(/@Get\('\/'\)\n\n/)

    const with_ = generateController({ ...ctx, swagger: true })
    expect(with_).toContain("@Get('/')\n  @ApiTags('Product')\n  @ApiQueryParams(")
  })

  it('reads the dependency from package.json, not node_modules', () => {
    // What the project DECLARES is what its generated code may import. A
    // transitively-installed copy is not a dependency this code can rely on.
    expect(hasSwagger(projectWith({ dependencies: { '@forinda/kickjs-swagger': '^7.1.0' } }))).toBe(
      true,
    )
    expect(
      hasSwagger(projectWith({ devDependencies: { '@forinda/kickjs-swagger': '^7.1.0' } })),
    ).toBe(true)
    expect(hasSwagger(projectWith({ dependencies: { '@forinda/kickjs': '^7.4.0' } }))).toBe(false)
    expect(hasSwagger(projectWith({}))).toBe(false)
  })

  it('answers for any package, not just swagger', () => {
    // `kick g job` needs the same answer about @forinda/kickjs-queue, and
    // refuses rather than writing a job file that imports a package the
    // project does not have.
    const dir = projectWith({ dependencies: { '@forinda/kickjs-queue': '^7.0.0' } })
    expect(hasDependency(dir, '@forinda/kickjs-queue')).toBe(true)
    expect(hasDependency(dir, '@forinda/kickjs-swagger')).toBe(false)
  })

  it('says no when there is no package.json to read', () => {
    const empty = mkdtempSync(join(tmpdir(), 'kick-swagger-'))
    dirs.push(empty)
    expect(hasSwagger(empty)).toBe(false)
  })
})
