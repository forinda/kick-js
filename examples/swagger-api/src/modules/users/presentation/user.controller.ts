import { Controller, Get, Post, Put, Delete, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@forinda/kickjs-swagger'
import { z } from 'zod'
import { CreateUserUseCase } from '../application/use-cases/create-user.use-case'
import { GetUserUseCase } from '../application/use-cases/get-user.use-case'
import { ListUsersUseCase } from '../application/use-cases/list-users.use-case'
import { UpdateUserUseCase } from '../application/use-cases/update-user.use-case'
import { DeleteUserUseCase } from '../application/use-cases/delete-user.use-case'
import { createUserSchema } from '../application/dtos/create-user.dto'
import { updateUserSchema } from '../application/dtos/update-user.dto'
import { listUsersQuerySchema } from '../application/dtos/list-users-query.dto'
import {
  userResponseSchema,
  paginatedUsersSchema,
} from '../application/dtos/user-response.dto'

const idParams = z.object({ id: z.string().uuid() })

@Controller()
@ApiTags('Users')
@ApiBearerAuth()
export class UserController {
  @Autowired() private createUserUseCase!: CreateUserUseCase
  @Autowired() private getUserUseCase!: GetUserUseCase
  @Autowired() private listUsersUseCase!: ListUsersUseCase
  @Autowired() private updateUserUseCase!: UpdateUserUseCase
  @Autowired() private deleteUserUseCase!: DeleteUserUseCase

  @Post('/', { body: createUserSchema })
  @ApiOperation({
    summary: 'Create a new user',
    description: 'Registers a new user with the given profile data. '
      + 'Demonstrates rich body validation: string constraints, email, regex password, '
      + 'enum role, nested profile object, and string array tags.',
  })
  @ApiResponse({ status: 201, description: 'User created successfully', schema: userResponseSchema })
  @ApiResponse({ status: 422, description: 'Validation error — invalid body fields' })
  @ApiResponse({ status: 409, description: 'Username or email already taken' })
  async create(ctx: RequestContext) {
    const result = await this.createUserUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Get('/', { query: listUsersQuerySchema })
  @ApiOperation({
    summary: 'List users with pagination and filtering',
    description: 'Demonstrates query parameter validation with coercion. '
      + 'Zod coerces string query params to numbers/enums. '
      + 'Returns a paginated response with metadata.',
  })
  @ApiResponse({ status: 200, description: 'Paginated list of users', schema: paginatedUsersSchema })
  async list(ctx: RequestContext) {
    const result = await this.listUsersUseCase.execute()
    ctx.json({
      data: result,
      meta: { page: 1, limit: 20, total: result.length, totalPages: 1 },
    })
  }

  @Get('/:id', { params: idParams })
  @ApiOperation({
    summary: 'Get user by ID',
    description: 'Demonstrates path parameter validation with UUID format.',
  })
  @ApiResponse({ status: 200, description: 'User found', schema: userResponseSchema })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getById(ctx: RequestContext) {
    const result = await this.getUserUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('User not found')
    ctx.json(result)
  }

  @Put('/:id', { params: idParams, body: updateUserSchema })
  @ApiOperation({
    summary: 'Update user profile',
    description: 'Demonstrates .partial() schema — all fields are optional. '
      + 'Password and acceptTerms are excluded via .omit().',
  })
  @ApiResponse({ status: 200, description: 'User updated', schema: userResponseSchema })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async update(ctx: RequestContext) {
    const result = await this.updateUserUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Delete('/:id', { params: idParams })
  @ApiOperation({
    summary: 'Delete a user',
    description: 'Permanently removes the user. Returns 204 No Content on success.',
    operationId: 'deleteUser',
  })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(ctx: RequestContext) {
    await this.deleteUserUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
