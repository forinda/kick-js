/**
 * Generated schema files must import the validation library the project
 * actually installed.
 *
 * `kick new --schema valibot|yup` writes exactly one of zod / valibot / yup
 * into package.json, so a hardcoded `import { z } from 'zod'` in a DTO is an
 * import that cannot resolve. Same rule the swagger / testHarness flags already
 * follow: never emit an import the project cannot satisfy.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateDto } from '../src/generators/dto'
import { generateCreateDTO, generateUpdateDTO } from '../src/generators/templates/dtos'
import { resolveSchemaLib } from '../src/config'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kick-schema-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function readOnly(dir: string): string {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
  expect(files).toHaveLength(1)
  return readFileSync(join(files[0]!.parentPath ?? dir, files[0]!.name), 'utf8')
}

/** A project root declaring `deps` as runtime dependencies. */
function projectWith(deps: Record<string, string>): string {
  const dir = tempDir()
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies: deps }))
  return dir
}

const EXPECTED = {
  zod: { import: `import { z } from 'zod'`, infer: 'z.infer<' },
  valibot: { import: `import * as v from 'valibot'`, infer: 'v.InferOutput<' },
  yup: { import: `import * as yup from 'yup'`, infer: 'yup.InferType<' },
} as const

describe('resolveSchemaLib', () => {
  it('reads the library from the project dependencies', () => {
    expect(resolveSchemaLib(projectWith({ valibot: '^1.0.0' }))).toBe('valibot')
    expect(resolveSchemaLib(projectWith({ yup: '^1.4.0' }))).toBe('yup')
    expect(resolveSchemaLib(projectWith({ zod: '^4.3.6' }))).toBe('zod')
  })

  it('falls back to zod when no validation library is declared', () => {
    // Covers a bare project and an unreadable package.json alike — emitting
    // today's default is the non-breaking answer when nothing proves otherwise.
    expect(resolveSchemaLib(projectWith({}))).toBe('zod')
    expect(resolveSchemaLib(tempDir())).toBe('zod')
  })

  it('prefers the deliberately chosen library when zod is also present', () => {
    // `kick new --schema valibot` is an explicit pick; zod turning up beside it
    // is more likely incidental than a second scaffold choice.
    expect(resolveSchemaLib(projectWith({ valibot: '^1.0.0', zod: '^4.3.6' }))).toBe('valibot')
  })

  it('ignores a devDependency-only install', () => {
    // A DTO schema is evaluated when its module loads, so `npm install
    // --omit=dev` would break the app in production.
    const dir = tempDir()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'app', devDependencies: { valibot: '^1.0.0' } }),
    )
    expect(resolveSchemaLib(dir)).toBe('zod')
  })
})

describe('kick g dto', () => {
  for (const [lib, expected] of Object.entries(EXPECTED)) {
    it(`writes the schema against ${lib}`, async () => {
      const dir = tempDir()
      await generateDto({
        name: 'createUser',
        outDir: dir,
        schemaLib: lib as keyof typeof EXPECTED,
      })
      const src = readOnly(dir)
      expect(src).toContain(expected.import)
      expect(src).toContain(expected.infer)
      for (const [other, shape] of Object.entries(EXPECTED)) {
        if (other !== lib) expect(src).not.toContain(shape.import)
      }
    })
  }

  it('still emits zod when the caller says nothing', async () => {
    const dir = tempDir()
    await generateDto({ name: 'createUser', outDir: dir })
    expect(readOnly(dir)).toContain(EXPECTED.zod.import)
  })
})

describe('kick g module DTOs', () => {
  for (const [lib, expected] of Object.entries(EXPECTED)) {
    it(`writes create + update against ${lib}`, () => {
      const ctx = { pascal: 'User', kebab: 'user', schemaLib: lib as keyof typeof EXPECTED }
      for (const src of [generateCreateDTO(ctx), generateUpdateDTO(ctx)]) {
        expect(src).toContain(expected.import)
        expect(src).toContain(expected.infer)
      }
    })
  }

  it('names the library it wrote, so the field examples match the import', () => {
    // The docblock lists library-specific builders; naming Zod above a valibot
    // schema is how the hardcoded version misled readers.
    expect(generateCreateDTO({ pascal: 'User', kebab: 'user', schemaLib: 'valibot' })).toContain(
      'Valibot schema for validating POST request bodies',
    )
  })
})
