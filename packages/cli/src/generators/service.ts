import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import type { ProjectPattern } from '../config'

interface GenerateServiceOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
}

export async function generateService(options: GenerateServiceOptions): Promise<string[]> {
  const { name, moduleName, modulesDir, pattern } = options
  const outDir = resolveOutDir({
    type: 'service',
    outDir: options.outDir,
    moduleName,
    modulesDir,
    defaultDir: 'src/services',
    pattern,
  })
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.service.ts`)
  await writeFileSafe(
    filePath,
    `import { Service } from '@forinda/kickjs'

@Service()
export class ${pascal}Service {
  // Inject dependencies via constructor
  // constructor(
  //   @Inject(MY_REPO) private readonly repo: IMyRepository,
  // ) {}
}
`,
  )
  files.push(filePath)

  return files
}
