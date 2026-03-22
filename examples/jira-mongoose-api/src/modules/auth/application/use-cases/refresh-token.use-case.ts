import { Service, Inject, HttpException } from '@forinda/kickjs-core';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import { env } from '@/config/env';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { RefreshTokenDto } from '../dtos/refresh-token.dto';

@Service()
export class RefreshTokenUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY) private refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(dto: RefreshTokenDto) {
    const stored = await this.refreshTokenRepo.findByToken(dto.refreshToken);
    if (!stored || stored.expiresAt < new Date()) {
      throw HttpException.unauthorized(ErrorCode.TOKEN_EXPIRED);
    }

    const user = await this.userRepo.findById(stored.userId.toString());
    if (!user || !user.isActive) {
      throw HttpException.unauthorized(ErrorCode.USER_NOT_FOUND);
    }

    // Rotate refresh token
    await this.refreshTokenRepo.deleteByToken(dto.refreshToken);
    const newRefreshToken = uuidv4();
    await this.refreshTokenRepo.create({
      userId: user._id.toString(),
      token: newRefreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const accessToken = jwt.sign(
      { sub: user._id.toString(), email: user.email, globalRole: user.globalRole },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any },
    );

    return { accessToken, refreshToken: newRefreshToken };
  }
}
