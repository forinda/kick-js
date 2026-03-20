export function generateController(
  pascal: string,
  kebab: string,
  plural: string,
  pluralPascal: string,
): string {
  return `import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ApiTags } from '@forinda/kickjs-swagger'
import { Create${pascal}UseCase } from '../application/use-cases/create-${kebab}.use-case'
import { Get${pascal}UseCase } from '../application/use-cases/get-${kebab}.use-case'
import { List${pluralPascal}UseCase } from '../application/use-cases/list-${plural}.use-case'
import { Update${pascal}UseCase } from '../application/use-cases/update-${kebab}.use-case'
import { Delete${pascal}UseCase } from '../application/use-cases/delete-${kebab}.use-case'
import { create${pascal}Schema } from '../application/dtos/create-${kebab}.dto'
import { update${pascal}Schema } from '../application/dtos/update-${kebab}.dto'
import { ${pascal.toUpperCase()}_QUERY_CONFIG } from '../constants'

@Controller()
export class ${pascal}Controller {
  @Autowired() private create${pascal}UseCase!: Create${pascal}UseCase
  @Autowired() private get${pascal}UseCase!: Get${pascal}UseCase
  @Autowired() private list${pluralPascal}UseCase!: List${pluralPascal}UseCase
  @Autowired() private update${pascal}UseCase!: Update${pascal}UseCase
  @Autowired() private delete${pascal}UseCase!: Delete${pascal}UseCase

  @Get('/')
  @ApiTags('${pascal}')
  @ApiQueryParams(${pascal.toUpperCase()}_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    return ctx.paginate(
      (parsed) => this.list${pluralPascal}UseCase.execute(parsed),
      ${pascal.toUpperCase()}_QUERY_CONFIG,
    )
  }

  @Get('/:id')
  @ApiTags('${pascal}')
  async getById(ctx: RequestContext) {
    const result = await this.get${pascal}UseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('${pascal} not found')
    ctx.json(result)
  }

  @Post('/', { body: create${pascal}Schema, name: 'Create${pascal}' })
  @ApiTags('${pascal}')
  async create(ctx: RequestContext) {
    const result = await this.create${pascal}UseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Put('/:id', { body: update${pascal}Schema, name: 'Update${pascal}' })
  @ApiTags('${pascal}')
  async update(ctx: RequestContext) {
    const result = await this.update${pascal}UseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiTags('${pascal}')
  async remove(ctx: RequestContext) {
    await this.delete${pascal}UseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
`
}
