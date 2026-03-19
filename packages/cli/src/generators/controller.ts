import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase } from '../utils/naming'

interface GenerateControllerOptions {
  name: string
  outDir: string
}

export async function generateController(options: GenerateControllerOptions): Promise<string[]> {
  const { name, outDir } = options
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const files: string[] = []

  const filePath = join(outDir, `${kebab}.controller.ts`)
  await writeFileSafe(
    filePath,
    `import { Controller, Get, Post, Autowired } from '@kickjs/core'
import type { RequestContext } from '@kickjs/http'

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
