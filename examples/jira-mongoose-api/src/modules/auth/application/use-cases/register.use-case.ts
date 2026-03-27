import { Service, Inject, HttpException, Logger } from '@forinda/kickjs-core';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { QUEUE_MANAGER, type QueueService } from '@forinda/kickjs-queue';
import { TOKENS } from '@/shared/constants/tokens';
import { ErrorCode } from '@/shared/constants/error-codes';
import { env } from '@/config/env';
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository';
import type { RegisterDto } from '../dtos/register.dto';

const logger = Logger.for('RegisterUseCase');

@Service()
export class RegisterUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY) private refreshTokenRepo: IRefreshTokenRepository,
    @Inject(QUEUE_MANAGER) private queueService: QueueService,
  ) {}

  async execute(dto: RegisterDto) {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) {
      throw HttpException.conflict(ErrorCode.EMAIL_ALREADY_EXISTS);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userRepo.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      globalRole: 'user',
      isActive: true,
    });

    const accessToken = this.generateAccessToken(user);
    const refreshToken = uuidv4();
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.refreshTokenRepo.create({
      userId: user._id.toString(),
      token: refreshToken,
      expiresAt: refreshExpiresAt,
    });

    // Queue welcome email
    try {
      await this.queueService.add('email', 'send-welcome-email', {
        email: user.email,
        firstName: user.firstName,
      },{delay: 5000}); // delay to ensure user creation completes
    } catch (err) {
      logger.warn('Failed to queue welcome email — continuing registration');
    }

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

  private generateAccessToken(user: any): string {
    return jwt.sign(
      { sub: user._id.toString(), email: user.email, globalRole: user.globalRole },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as any },
    );
  }
}
