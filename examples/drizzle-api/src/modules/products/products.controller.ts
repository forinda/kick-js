import { Controller, Get, Post, Put, Delete, Autowired, ApiQueryParams } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ProductsService } from './products.service'
import { ApiTags } from '@forinda/kickjs-swagger'

@Controller('/')
export class ProductsController {
  @Autowired() private productsService!: ProductsService

  @Get('/')
  @ApiTags('Products')
  @ApiQueryParams({
    filterable: ['name', 'category', 'price', 'stock'],
    sortable: ['name', 'price', 'createdAt'],
    searchable: ['name', 'description', 'category'],
  })
  list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filterable: ['name', 'category', 'price', 'stock'],
      sortable: ['name', 'price', 'createdAt'],
    })
    return ctx.json(this.productsService.findAll(parsed))
  }

  @Get('/:id')
  @ApiTags('Products')
  getById(ctx: RequestContext) {
    const product = this.productsService.findById(Number(ctx.params.id))
    if (!product) return ctx.notFound()
    return ctx.json(product)
  }

  @Post('/')
  @ApiTags('Products')
  create(ctx: RequestContext) {
    const product = this.productsService.create(ctx.body)
    return ctx.created(product)
  }

  @Put('/:id')
  @ApiTags('Products')
  update(ctx: RequestContext) {
    const product = this.productsService.update(Number(ctx.params.id), ctx.body)
    if (!product) return ctx.notFound()
    return ctx.json(product)
  }

  @Delete('/:id')
  @ApiTags('Products')
  remove(ctx: RequestContext) {
    const product = this.productsService.delete(Number(ctx.params.id))
    if (!product) return ctx.notFound()
    return ctx.noContent()
  }
}
