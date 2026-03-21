import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import type { ProjectPattern } from '../config'

interface GenerateDtoOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
}

export async function generateDto(options: GenerateDtoOptions): Promise<string[]> {
  const { name, moduleName, modulesDir, pattern } = options
  const outDir = resolveOutDir({
    type: 'dto',
    outDir: options.outDir,
    moduleName,
    modulesDir,
    defaultDir: 'src/dtos',
    pattern,
  })
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const camel = toCamelCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.dto.ts`)
  await writeFileSafe(
    filePath,
    `import { z } from 'zod'

export const ${camel}Schema = z.object({
  // Define your schema fields here
  name: z.string().min(1).max(200),
})

export type ${pascal}DTO = z.infer<typeof ${camel}Schema>
`,
  )
  files.push(filePath)

  return files
}
