import { Controller, Get, Patch, Middleware, ApiQueryParams, Autowired } from '@forinda/kickjs';
import { Roles } from '@forinda/kickjs-auth';
import type { RequestContext } from '@forinda/kickjs';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@forinda/kickjs-swagger';
import { updateProfileSchema } from '../application/dtos/update-profile.dto';
import { USER_QUERY_CONFIG } from '@/shared/constants/query-configs';

import { GetProfileUseCase } from '../application/use-cases/get-profile.use-case';
import { UpdateProfileUseCase } from '../application/use-cases/update-profile.use-case';
import { ListUsersUseCase } from '../application/use-cases/list-users.use-case';
import { successResponse } from '@/shared/application/api-response.dto';
import { z } from 'zod';
import { authBridgeMiddleware } from '@/shared/presentation/middlewares/auth-bridge.middleware';
import { getUser } from '@/shared/utils/auth';

@ApiTags('Users')
@ApiBearerAuth()
@Middleware(authBridgeMiddleware)
@Controller()
export class UsersController {
  @Autowired() private getProfileUseCase!: GetProfileUseCase;
  @Autowired() private updateProfileUseCase!: UpdateProfileUseCase;
  @Autowired() private listUsersUseCase!: ListUsersUseCase;

  @Get('/me')
  @ApiOperation({ summary: 'Get the current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(ctx: RequestContext) {
    const user = getUser(ctx);
    const result = await this.getProfileUseCase.execute(user.id);
    ctx.json(successResponse(result));
  }

  @Patch('/me', { body: updateProfileSchema })
  @ApiOperation({ summary: 'Update the current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Profile updated successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateMe(ctx: RequestContext) {
    const user = getUser(ctx);
    const result = await this.updateProfileUseCase.execute(user.id, ctx.body);
    ctx.json(successResponse(result));
  }

  @Get('/:id', { params: z.object({ id: z.string() }) })
  @ApiOperation({ summary: 'Get a user by ID' })
  @ApiResponse({ status: 200, description: 'User retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getById(ctx: RequestContext) {
    const result = await this.getProfileUseCase.execute(ctx.params.id);
    ctx.json(successResponse(result));
  }

  @Get('/')
  @Roles('superadmin')
  @ApiOperation({ summary: 'List all users (superadmin only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of users' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - requires superadmin role' })
  @ApiQueryParams(USER_QUERY_CONFIG)
  async list(ctx: RequestContext) {
    await ctx.paginate(
      (parsed) => this.listUsersUseCase.execute(parsed),
      USER_QUERY_CONFIG,
    );
  }
}
