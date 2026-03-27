import { join, resolve } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, pluralize } from '../utils/naming'

interface GenerateTestOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
}

export async function generateTest(options: GenerateTestOptions): Promise<string[]> {
  const { name, moduleName, modulesDir } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  // Resolve output directory
  let outDir: string
  if (options.outDir) {
    outDir = resolve(options.outDir)
  } else if (moduleName) {
    const modKebab = toKebabCase(moduleName)
    const modPlural = pluralize(modKebab)
    const modDir = modulesDir ?? 'src/modules'
    outDir = resolve(join(modDir, modPlural, '__tests__'))
  } else {
    outDir = resolve('src/__tests__')
  }

  const filePath = join(outDir, `${kebab}.test.ts`)
  await writeFileSafe(
    filePath,
    `import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '@forinda/kickjs'

describe('${pascal}', () => {
  beforeEach(() => {
    Container.reset()
  })

  it('should be defined', () => {
    // TODO: Import and test your class/function here
    expect(true).toBe(true)
  })

  it('should handle the happy path', async () => {
    // TODO: Set up test data and assertions
    expect(true).toBe(true)
  })

  it('should handle edge cases', async () => {
    // TODO: Test error handling, empty inputs, etc.
    expect(true).toBe(true)
  })
})
`,
  )
  files.push(filePath)

  return files
}
