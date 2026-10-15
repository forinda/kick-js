/**
 * `src/core/di` is the DI core: it imports only itself and `reflect-metadata`.
 * The framework plugs in through the container's hooks (`src/core/di-hooks.ts`),
 * never the other way round.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(import.meta.dirname, '../src/core/di')
const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))

it.each(files)('di/%s imports nothing outside src/core/di', (file) => {
  const source = readFileSync(join(dir, file), 'utf-8')
  const specifiers = [
    ...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gm),
  ].map((m) => m[1] ?? m[2])
  const outside = specifiers.filter((s) => s !== 'reflect-metadata' && !/^\.\/[\w-]+$/.test(s))
  expect(outside).toEqual([])
})

it('finds the DI files', () => {
  expect(files).toEqual(
    expect.arrayContaining(['container.ts', 'decorators.ts', 'errors.ts', 'interfaces.ts']),
  )
})
