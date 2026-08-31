/**
 * Nothing the CLI writes should teach the Express-only test pattern.
 *
 * The HTTP engine is pluggable, but every generated sample drove
 * `request(expressApp)`. Scaffolded docs are copied before anyone reads a
 * guide, so a stale sample there propagates into projects that never see the
 * corrected documentation — and under Fastify or h3 `expressApp` is the wrong
 * object entirely.
 *
 * @module @forinda/kickjs-cli/__tests__/generated-docs-runtime-neutral.test
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Sources whose string literals end up in a generated project or in CLI output. */
const EMITTERS = [
  'src/generators/templates/project-docs.ts',
  'src/generators/templates/project-config.ts',
  'src/generators/templates/tests.ts',
  'src/explain/known-issues.ts',
]

const ROOT = join(__dirname, '..')

describe('CLI-emitted samples', () => {
  it.each(EMITTERS)('%s does not hand out expressApp', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    // Prose explaining why NOT to use it is fine; a sample destructuring or
    // calling it is not.
    expect(source).not.toMatch(/const \{[^}]*\bexpressApp\b[^}]*\}\s*=/)
    expect(source).not.toMatch(/request\(\s*expressApp\s*\)/)
  })
})

describe('generated skill docs follow modules.style', () => {
  // `buildSkills` emitted `UserModule()` unconditionally. Under
  // `modules.style: 'class'` that calls a class without `new`; under
  // `define` the bare name is refused for a configurable module. The
  // scaffolded guidance has to match the project it was generated for.
  it('invokes the module for define style', async () => {
    const { generateKickJsSkillFiles } = await import('../src/generators/templates/project-docs')
    const files = generateKickJsSkillFiles('demo', 'rest', 'pnpm', 'define')
    const test = files.find((f) => f.slug.includes('controller-test'))!
    expect(test.content).toContain('modules: [UserModule()]')
  })

  it('passes the module bare for class style', async () => {
    const { generateKickJsSkillFiles } = await import('../src/generators/templates/project-docs')
    const files = generateKickJsSkillFiles('demo', 'rest', 'pnpm', 'class')
    const test = files.find((f) => f.slug.includes('controller-test'))!
    expect(test.content).toContain('modules: [UserModule]')
    expect(test.content).not.toContain('modules: [UserModule()]')
  })
})
