import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Autowired,
  Middleware,
  HttpException,
  Inject,
} from '@forinda/kickjs-core'
import type { RequestContext } from '@forinda/kickjs-http'
import { authGuard, createMockToken } from '../../../middleware/auth.middleware'
import { USERS_REPOSITORY, type IUsersRepository } from '../domain/repositories/users.repository'
import { CreateUsersUseCase } from '../application/use-cases/create-users.use-case'
import { GetUsersUseCase } from '../application/use-cases/get-users.use-case'
import { ListUsersUseCase } from '../application/use-cases/list-users.use-case'
import { UpdateUsersUseCase } from '../application/use-cases/update-users.use-case'
import { DeleteUsersUseCase } from '../application/use-cases/delete-users.use-case'
import { createUsersSchema } from '../application/dtos/create-users.dto'
import { updateUsersSchema } from '../application/dtos/update-users.dto'
import { loginSchema } from '../application/dtos/login.dto'

@Controller()
export class UsersController {
  @Autowired() private createUsersUseCase!: CreateUsersUseCase
  @Autowired() private getUsersUseCase!: GetUsersUseCase
  @Autowired() private listUsersUseCase!: ListUsersUseCase
  @Autowired() private updateUsersUseCase!: UpdateUsersUseCase
  @Autowired() private deleteUsersUseCase!: DeleteUsersUseCase

  @Inject(USERS_REPOSITORY) private readonly repo!: IUsersRepository

  // -- Public auth endpoints (no guard) --

  @Post('/register', { body: createUsersSchema })
  async register(ctx: RequestContext) {
    const existing = await this.repo.findByEmail(ctx.body.email)
    if (existing) {
      throw HttpException.badRequest('Email already registered')
    }

    const user = await this.createUsersUseCase.execute(ctx.body)
    const token = createMockToken({ sub: user.id, email: user.email })
    ctx.created({ user, token })
  }

  @Post('/login', { body: loginSchema })
  async login(ctx: RequestContext) {
    const { email, password } = ctx.body
    const user = await this.repo.findByEmail(email)

    if (!user || user.password !== password) {
      throw HttpException.unauthorized('Invalid email or password')
    }

    const token = createMockToken({ sub: user.id, email: user.email })
    ctx.json({ token })
  }

  // -- Protected endpoints (require auth) --

  @Middleware(authGuard)
  @Get('/me')
  async me(ctx: RequestContext) {
    const { sub } = (ctx.req as any).user
    const user = await this.getUsersUseCase.execute(sub)
    if (!user) return ctx.notFound('User not found')
    ctx.json(user)
  }

  @Middleware(authGuard)
  @Get('/')
  async list(ctx: RequestContext) {
    const result = await this.listUsersUseCase.execute()
    ctx.json(result)
  }

  @Middleware(authGuard)
  @Get('/:id')
  async getById(ctx: RequestContext) {
    const result = await this.getUsersUseCase.execute(ctx.params.id)
    if (!result) return ctx.notFound('User not found')
    ctx.json(result)
  }

  @Middleware(authGuard)
  @Put('/:id', { body: updateUsersSchema })
  async update(ctx: RequestContext) {
    const result = await this.updateUsersUseCase.execute(ctx.params.id, ctx.body)
    ctx.json(result)
  }

  @Middleware(authGuard)
  @Delete('/:id')
  async remove(ctx: RequestContext) {
    await this.deleteUsersUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
