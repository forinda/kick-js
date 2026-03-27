import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import type { ProjectPattern } from '../config'

interface GenerateControllerOptions {
  name: string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
}

export async function generateController(options: GenerateControllerOptions): Promise<string[]> {
  const { name, moduleName, modulesDir, pattern } = options
  const outDir = resolveOutDir({
    type: 'controller',
    outDir: options.outDir,
    moduleName,
    modulesDir,
    defaultDir: 'src/controllers',
    pattern,
  })
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.controller.ts`)
  await writeFileSafe(
    filePath,
    `import { Controller, Get, Post, Autowired } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'

@Controller()
export class ${pascal}Controller {
  // @Autowired() private myService!: MyService

  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json({ message: '${pascal} list' })
  }

  @Post('/')
  async create(ctx: RequestContext) {
    ctx.created({ message: '${pascal} created', data: ctx.body })
  }
}
`,
  )
  files.push(filePath)

  return files
}
