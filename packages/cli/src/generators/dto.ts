import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import { SCHEMA_SHAPES, objectSchema } from './templates/dtos'
import type { ProjectPattern, SchemaLib } from '../config'

interface GenerateDtoOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
  pluralize?: boolean
  /**
   * Validation library to write the schema against. Defaults to `'zod'`.
   * The command resolves it from the project's dependencies — a scaffold
   * created with `--schema valibot` never installs zod, so emitting a zod
   * import there produces a file that cannot resolve.
   */
  schemaLib?: SchemaLib
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
    shouldPluralize: options.pluralize ?? true,
  })
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const camel = toCamelCase(name)
  const lib = options.schemaLib ?? 'zod'
  const shape = SCHEMA_SHAPES[lib]
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.dto.ts`)
  await writeFileSafe(
    filePath,
    `${shape.import}

export const ${camel}Schema = ${objectSchema(lib, `// Define your schema fields here\n  name: ${shape.required}`)}

export type ${pascal}DTO = ${shape.infer(`${camel}Schema`)}
`,
  )
  files.push(filePath)

  return files
}
