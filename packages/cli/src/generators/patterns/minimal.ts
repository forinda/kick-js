import type { ModuleContext } from './types'
import { generateMinimalModuleIndex } from '../templates'

export async function generateMinimalFiles(ctx: ModuleContext): Promise<void> {
  const { pascal, kebab, plural, write } = ctx

  await write('index.ts', generateMinimalModuleIndex({ pascal, kebab, plural }))

  await write(
    `${kebab}.controller.ts`,
    `import { Controller, Get } from '@forinda/kickjs'
import type { RequestContext } from '@forinda/kickjs'

@Controller()
export class ${pascal}Controller {
  @Get('/')
  async list(ctx: RequestContext) {
    ctx.json({ message: '${pascal} list' })
  }
}
`,
  )
}
