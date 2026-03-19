import { z } from 'zod'
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Autowired,
} from '@kickjs/core'
import type { RequestContext } from '@kickjs/http'
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@kickjs/swagger'
import { createProductsSchema } from '../application/dtos/create-products.dto'
import { updateProductsSchema } from '../application/dtos/update-products.dto'
import { CreateProductsUseCase } from '../application/use-cases/create-products.use-case'
import { GetProductsUseCase } from '../application/use-cases/get-products.use-case'
import { ListProductsUseCase } from '../application/use-cases/list-products.use-case'
import { UpdateProductsUseCase } from '../application/use-cases/update-products.use-case'
import { DeleteProductsUseCase } from '../application/use-cases/delete-products.use-case'

// -- Param schemas ----------------------------------------------------------

const productIdParams = z.object({
  id: z.string().uuid('Product ID must be a valid UUID'),
})

// -- Controller -------------------------------------------------------------

@ApiTags('Products')
@Controller()
export class ProductsController {
  @Autowired() private createProductsUseCase!: CreateProductsUseCase
  @Autowired() private getProductsUseCase!: GetProductsUseCase
  @Autowired() private listProductsUseCase!: ListProductsUseCase
  @Autowired() private updateProductsUseCase!: UpdateProductsUseCase
  @Autowired() private deleteProductsUseCase!: DeleteProductsUseCase

  /**
   * List products with filtering, sorting, and pagination.
   *
   * Query string examples:
   *   ?filter=status:eq:active&filter=category:in:electronics,books
   *   ?sort=price:asc&sort=name:desc
   *   ?page=2&limit=10
   *   ?q=wireless
   */
  @ApiOperation({
    summary: 'List products',
    description:
      'Retrieve a paginated list of products with optional filtering, sorting, and search. '
      + 'Filterable fields: status, category. '
      + 'Sortable fields: price, name, createdAt.',
  })
  @ApiResponse({ status: 200, description: 'Paginated product list' })
  @Get('/')
  async list(ctx: RequestContext) {
    const parsed = ctx.qs({
      filterable: ['status', 'category'],
      sortable: ['price', 'name', 'createdAt'],
      searchable: ['name', 'description'],
    })

    const allProducts = await this.listProductsUseCase.execute()

    // Apply in-memory filtering for demonstration purposes
    let results = allProducts

    for (const filter of parsed.filters) {
      results = results.filter((p: Record<string, any>) => {
        const val = String(p[filter.field] ?? '')
        switch (filter.operator) {
          case 'eq':
            return val === filter.value
          case 'neq':
            return val !== filter.value
          case 'in':
            return filter.value.split(',').includes(val)
          case 'contains':
            return val.toLowerCase().includes(filter.value.toLowerCase())
          default:
            return true
        }
      })
    }

    // Apply search across searchable fields
    if (parsed.search) {
      const q = parsed.search.toLowerCase()
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q)
          || (p.description ?? '').toLowerCase().includes(q),
      )
    }

    // Apply sorting
    for (const sort of [...parsed.sort].reverse()) {
      results = [...results].sort((a: Record<string, any>, b: Record<string, any>) => {
        const aVal = a[sort.field]
        const bVal = b[sort.field]
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return sort.direction === 'asc' ? cmp : -cmp
      })
    }

    // Apply pagination
    const { page, limit, offset } = parsed.pagination
    const paged = results.slice(offset, offset + limit)

    ctx.json({
      data: paged,
      meta: {
        total: results.length,
        page,
        limit,
        totalPages: Math.ceil(results.length / limit),
      },
      query: parsed,
    })
  }

  @ApiOperation({
    summary: 'Create a product',
    description: 'Create a new product with Zod-validated body fields',
  })
  @ApiResponse({ status: 201, description: 'Product created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @Post('/', { body: createProductsSchema })
  async create(ctx: RequestContext) {
    const result = await this.createProductsUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @ApiOperation({
    summary: 'Get a product by ID',
    description: 'Retrieve a single product by its UUID',
  })
  @ApiResponse({ status: 200, description: 'Product found' })
  @ApiResponse({ status: 400, description: 'Invalid UUID format' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @Get('/:id', { params: productIdParams })
  async getById(ctx: RequestContext) {
    const result = await this.getProductsUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('Product not found')
    ctx.json(result)
  }

  @ApiOperation({
    summary: 'Update a product',
    description: 'Partially update an existing product. All fields are optional.',
  })
  @ApiResponse({ status: 200, description: 'Product updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @Put('/:id', { params: productIdParams, body: updateProductsSchema })
  async update(ctx: RequestContext) {
    const result = await this.updateProductsUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @ApiOperation({
    summary: 'Delete a product',
    description: 'Permanently delete a product by its UUID',
  })
  @ApiResponse({ status: 204, description: 'Product deleted' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @Delete('/:id', { params: productIdParams })
  async remove(ctx: RequestContext) {
    await this.deleteProductsUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
