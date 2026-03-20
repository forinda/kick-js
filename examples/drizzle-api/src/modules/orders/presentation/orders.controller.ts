/**
 * Orders Controller
 *
 * Presentation layer — handles HTTP requests and delegates to use cases.
 * Each method receives a RequestContext with typed body, params, and query.
 *
 * Decorators:
 *   @Controller(path?) — registers this class as an HTTP controller
 *   @Get/@Post/@Put/@Delete(path?, validation?) — defines routes with optional Zod validation
 *   @Autowired() — injects dependencies lazily from the DI container
 *   @Middleware(...handlers) — attach middleware at class or method level
 *
 * Add Swagger decorators (@ApiTags, @ApiOperation, @ApiResponse) from @forinda/kickjs-swagger
 * for automatic OpenAPI documentation.
 */
import { Controller, Get, Post, Put, Delete, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import { CreateOrdersUseCase } from '../application/use-cases/create-orders.use-case'
import { GetOrdersUseCase } from '../application/use-cases/get-orders.use-case'
import { ListOrdersUseCase } from '../application/use-cases/list-orders.use-case'
import { UpdateOrdersUseCase } from '../application/use-cases/update-orders.use-case'
import { DeleteOrdersUseCase } from '../application/use-cases/delete-orders.use-case'
import { createOrdersSchema } from '../application/dtos/create-orders.dto'
import { updateOrdersSchema } from '../application/dtos/update-orders.dto'

@Controller()
export class OrdersController {
  @Autowired() private createOrdersUseCase!: CreateOrdersUseCase
  @Autowired() private getOrdersUseCase!: GetOrdersUseCase
  @Autowired() private listOrdersUseCase!: ListOrdersUseCase
  @Autowired() private updateOrdersUseCase!: UpdateOrdersUseCase
  @Autowired() private deleteOrdersUseCase!: DeleteOrdersUseCase

  @Post('/', { body: createOrdersSchema })
  async create(ctx: RequestContext) {
    const result = await this.createOrdersUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.listOrdersUseCase.execute()
    ctx.json(result)
  }

  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.getOrdersUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Orders not found')
    ctx.json(result)
  }

  @Put('/:id', { body: updateOrdersSchema })
  async update(ctx: RequestContext) {
    const result = await this.updateOrdersUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.deleteOrdersUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
