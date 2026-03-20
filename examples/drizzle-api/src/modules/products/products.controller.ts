import { Controller, Get, Post, Put, Delete, Autowired } from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { ProductsService } from './products.service'

@Controller('/')
export class ProductsController {
  @Autowired() private productsService!: ProductsService

  @Get('/')
  list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filters: ['name', 'category', 'price', 'stock'],
      sort: ['name', 'price', 'createdAt'],
    })
    return ctx.json(this.productsService.findAll(parsed))
  }

  @Get('/:id')
  getById(ctx: RequestContext) {
    const product = this.productsService.findById(Number(ctx.params.id))
    if (!product) return ctx.notFound()
    return ctx.json(product)
  }

  @Post('/')
  create(ctx: RequestContext) {
    const product = this.productsService.create(ctx.body)
    return ctx.created(product)
  }

  @Put('/:id')
  update(ctx: RequestContext) {
    const product = this.productsService.update(Number(ctx.params.id), ctx.body)
    if (!product) return ctx.notFound()
    return ctx.json(product)
  }

  @Delete('/:id')
  remove(ctx: RequestContext) {
    const product = this.productsService.delete(Number(ctx.params.id))
    if (!product) return ctx.notFound()
    return ctx.noContent()
  }
}
