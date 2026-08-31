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
