/**
 * Drift guard: the `@` path alias must be declared in all THREE places the
 * scaffold ships it — tsconfig `paths`, vite `resolve.alias`, and vitest
 * `resolve.alias`.
 *
 * Vitest does not read tsconfig paths. When only vite carried the alias, an
 * `@/…` import type-checked and built fine and failed only under test, which
 * is the worst place to discover it. `kick g module --repo prisma` emits such
 * imports whenever `prismaClientPath` is the Prisma 7 default
 * (`@/generated/prisma/client`).
 */
import { describe, it, expect } from 'vitest'

import {
  generateViteConfig,
  generateVitestConfig,
  generateTsConfig,
} from '../src/generators/templates/project-config'

describe('@ alias parity across the scaffold', () => {
  it('is declared for vite, vitest, and tsconfig alike', () => {
    const alias = "'@': resolve(__dirname, 'src')"

    expect(generateViteConfig()).toContain(alias)
    expect(generateVitestConfig()).toContain(alias)
    expect(JSON.parse(generateTsConfig()).compilerOptions.paths['@/*']).toEqual(['./src/*'])
  })

  it('gives the vitest config the node:path import its alias needs', () => {
    const cfg = generateVitestConfig()
    // `resolve(...)` in the alias is a ReferenceError without this import,
    // so the config would throw before a single test ran.
    expect(cfg).toContain("import { resolve } from 'node:path'")
  })
})
