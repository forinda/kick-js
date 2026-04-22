import { Controller, Get, Post, Middleware, Autowired } from '@forinda/kickjs';
import { Public } from '@forinda/kickjs-auth';
import type { RequestContext } from '@forinda/kickjs';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { registerSchema } from '../application/dtos/register.dto';
import { loginSchema } from '../application/dtos/login.dto';
import { refreshTokenSchema } from '../application/dtos/refresh-token.dto';
import { RegisterUseCase } from '../application/use-cases/register.use-case';
import { LoginUseCase } from '../application/use-cases/login.use-case';
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token.use-case';
import { LogoutUseCase } from '../application/use-cases/logout.use-case';
import { successResponse } from '@/shared/application/api-response.dto';

@ApiTags('Auth')
@Controller()
export class AuthController {
  @Autowired() private registerUseCase!: RegisterUseCase;
  @Autowired() private loginUseCase!: LoginUseCase;
  @Autowired() private refreshTokenUseCase!: RefreshTokenUseCase;
  @Autowired() private logoutUseCase!: LogoutUseCase;

  @Post('/register', { body: registerSchema })
  @Public()
  @ApiOperation({ summary: 'Register a new user account' })
  @ApiResponse({ status: 201, description: 'Registration successful' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async register(ctx: RequestContext) {
    const result = await this.registerUseCase.execute(ctx.body);
    ctx.created(successResponse(result, 'Registration successful'));
  }

  @Post('/login', { body: loginSchema })
  @Public()
  @ApiOperation({ summary: 'Log in with credentials' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(ctx: RequestContext) {
    const result = await this.loginUseCase.execute(ctx.body);
    ctx.json(successResponse(result, 'Login successful'));
  }

  @Post('/refresh', { body: refreshTokenSchema })
  @Public()
  @ApiOperation({ summary: 'Refresh an access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(ctx: RequestContext) {
    const result = await this.refreshTokenUseCase.execute(ctx.body);
    ctx.json(successResponse(result));
  }

  @Post('/logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out and invalidate refresh token' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(ctx: RequestContext) {
    const { refreshToken } = ctx.body;
    await this.logoutUseCase.execute(refreshToken);
    ctx.json(successResponse(null, 'Logged out successfully'));
  }
}
