import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import { env } from '@/config/env'
import type { IUserRepository } from '@/modules/users/domain/repositories/user.repository'
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository'
import type { RegisterDTO } from '../dtos/register.dto'

@Service()
export class RegisterUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY)
    private userRepo: IUserRepository,
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY)
    private refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(dto: RegisterDTO) {
    const existing = await this.userRepo.findByEmail(dto.email)
    if (existing) {
      throw HttpException.conflict(ErrorCode.EMAIL_ALREADY_EXISTS)
    }

    const passwordHash = await bcrypt.hash(dto.password, 12)

    const user = await this.userRepo.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
    })

    const accessToken = this.generateAccessToken(user)
    const refreshToken = crypto.randomUUID()

    await this.refreshTokenRepo.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    return { user, accessToken, refreshToken }
  }

  private generateAccessToken(user: any): string {
    return jwt.sign(
      { sub: user.id, email: user.email, globalRole: user.globalRole },
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRES_IN as string & jwt.SignOptions["expiresIn"] },
    )
  }
}
