import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'

interface GenerateDtoOptions {
  name: string
  outDir: string
}

export async function generateDto(options: GenerateDtoOptions): Promise<string[]> {
  const { name, outDir } = options
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
