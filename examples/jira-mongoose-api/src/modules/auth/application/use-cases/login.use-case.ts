import { Service, Inject, HttpException } from '@forinda/kickjs-core';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import { env } from '@/config/env';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { LoginDto } from '../dtos/login.dto';

@Service()
export class LoginUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY) private refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(dto: LoginDto) {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) {
      throw HttpException.unauthorized(ErrorCode.INVALID_CREDENTIALS);
    }

    if (!user.isActive) {
      throw HttpException.forbidden(ErrorCode.USER_INACTIVE);
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw HttpException.unauthorized(ErrorCode.INVALID_CREDENTIALS);
    }

    await this.userRepo.update(user._id.toString(), { lastLoginAt: new Date() });

    const accessToken = jwt.sign(
      { sub: user._id.toString(), email: user.email, globalRole: user.globalRole },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any },
    );

    const refreshToken = uuidv4();
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.refreshTokenRepo.create({
      userId: user._id.toString(),
      token: refreshToken,
      expiresAt: refreshExpiresAt,
    });

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        globalRole: user.globalRole,
      },
      accessToken,
      refreshToken,
    };
  }
}
