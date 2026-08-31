/**
 * Generated controller tests have to assert something.
 *
 * Every case was `expect(true).toBe(true)`, so `kick g module widgets` produced
 * a suite reporting 7 passed while asserting nothing — and it kept reporting 7
 * passed after every route it named had been deleted. That is worse than no
 * suite: it survives review, and it makes `pnpm test` stop carrying
 * information.
 *
 * @module @forinda/kickjs-cli/__tests__/generated-tests-assert.test
 */

import { describe, expect, it } from 'vitest'

import { generateControllerTest } from '../src/generators/templates/tests'

const base = { pascal: 'Widget', kebab: 'widget', plural: 'widgets' }
/** A scaffolded project: `kick new` installs kickjs-testing + supertest. */
const ctx = { ...base, testHarness: true }
/** A project without the harness — the generated file must still compile. */
const bare = { ...base, testHarness: false }

describe('generated controller test', () => {
  it.each([
    ['with the harness', ctx],
    ['without the harness', bare],
  ])('contains no unconditional assertion %s', (_label, given) => {
    expect(generateControllerTest(given)).not.toContain('expect(true).toBe(true)')
  })

  it('imports nothing it cannot resolve when the harness is absent', () => {
    // Same rule that gates @ApiTags on `swagger`: emitting an import for a
    // package that is not installed produces a file that cannot compile. The
    // first version of this fix broke `kick g module` in a bare project
    // exactly that way.
    const source = generateControllerTest(bare)
    // Imports specifically — the header still NAMES both packages, in a comment
    // telling you what to install to turn the real test on. That is guidance,
    // not an unresolvable import.
    expect(source).not.toMatch(/^import .*supertest/m)
    expect(source).not.toMatch(/^import .*@forinda\/kickjs-testing/m)
    // Still honest: every case is a todo, none is a fake pass.
    expect(source).toMatch(/it\.todo\(/)
    expect(source).not.toMatch(/^\s+it\('/m)
  })

  it('marks unwritten cases as todo, which cannot be counted as passing', () => {
    const source = generateControllerTest(ctx)
    expect(source).toMatch(/it\.todo\(/)
    // Every `it(` that is not a todo must carry a real expectation; the whole
    // point is that the reporter distinguishes them.
    const plainIts = source.match(/^\s+it\('/gm) ?? []
    expect(plainIts.length).toBeGreaterThan(0)
    expect(source).toContain('expect(res.status).toBe(200)')
  })

  it('exercises the module through the real pipeline', () => {
    const source = generateControllerTest(ctx)
    expect(source).toContain('createTestApp')
    // Runtime-neutral: `expressApp` would tie the generated suite to Express
    // even in a project configured for Fastify or h3.
    expect(source).toContain('app.handle.bind(app)')
    expect(source).not.toContain('expressApp')
  })

  it('states the mount path it assumes, so a versioned app can correct it', () => {
    // The CLI cannot know `apiPrefix` / `defaultVersion` — those are bootstrap()
    // options, not kick.config.ts. createTestApp uses the framework defaults, so
    // the generated path is right as written; the test says so and shows what
    // to change when production differs.
    const source = generateControllerTest(ctx)
    expect(source).toContain("const BASE = '/api/v1/widgets'")
    expect(source).toContain('defaultVersion')
  })

  it('passes the module in the shape its declaration style requires', () => {
    // `define` modules are factories, `class` modules are the class itself.
    // Getting this wrong is `TypeError: entry is not a constructor`.
    expect(generateControllerTest({ ...ctx, style: 'define' })).toContain('[WidgetModule()]')
    expect(generateControllerTest({ ...ctx, style: 'class' })).toContain('[WidgetModule]')
  })
})
