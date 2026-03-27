import { Controller, Post, Autowired } from '@forinda/kickjs-core'
import { ApiTags, ApiBearerAuth } from '@forinda/kickjs-swagger'
import type { RequestContext } from '@forinda/kickjs-http'
import { Middleware } from '@forinda/kickjs-core'
import { successResponse } from '@/shared/application/api-response.dto'
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware'
import { getUser } from '@/shared/utils/auth'
import { RegisterUseCase } from '../application/use-cases/register.use-case'
import { LoginUseCase } from '../application/use-cases/login.use-case'
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token.use-case'
import { LogoutUseCase } from '../application/use-cases/logout.use-case'
import { registerSchema } from '../application/dtos/register.dto'
import { loginSchema } from '../application/dtos/login.dto'
import { refreshTokenSchema } from '../application/dtos/refresh-token.dto'

@Controller()
export class AuthController {
  @Autowired() private registerUseCase!: RegisterUseCase
  @Autowired() private loginUseCase!: LoginUseCase
  @Autowired() private refreshTokenUseCase!: RefreshTokenUseCase
  @Autowired() private logoutUseCase!: LogoutUseCase

  @Post('/register', { body: registerSchema, name: 'Register' })
  @ApiTags('Auth')
  async register(ctx: RequestContext) {
    const result = await this.registerUseCase.execute(ctx.body)
    ctx.created(successResponse(result))
  }

  @Post('/login', { body: loginSchema, name: 'Login' })
  @ApiTags('Auth')
  async login(ctx: RequestContext) {
    const result = await this.loginUseCase.execute(ctx.body)
    ctx.json(successResponse(result))
  }

  @Post('/refresh', { body: refreshTokenSchema, name: 'RefreshToken' })
  @ApiTags('Auth')
  async refresh(ctx: RequestContext) {
    const result = await this.refreshTokenUseCase.execute(ctx.body.refreshToken)
    ctx.json(successResponse(result))
  }

  @Post('/logout')
  @ApiTags('Auth')
  @ApiBearerAuth()
  @Middleware(authBridgeMiddleware)
  async logout(ctx: RequestContext) {
    getUser(ctx) // Ensure authenticated
    const { refreshToken } = ctx.body
    await this.logoutUseCase.execute(refreshToken)
    ctx.json(successResponse(null, 'Logged out successfully'))
  }
}
