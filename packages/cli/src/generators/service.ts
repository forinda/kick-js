import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase } from '../utils/naming'

interface GenerateServiceOptions {
  name: string
  outDir: string
}

export async function generateService(options: GenerateServiceOptions): Promise<string[]> {
  const { name, outDir } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.service.ts`)
  await writeFileSafe(
    filePath,
    `import { Service } from '@forinda/kickjs-core'

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
