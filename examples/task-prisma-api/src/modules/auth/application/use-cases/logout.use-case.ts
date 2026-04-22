import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token.repository'

@Service()
export class LogoutUseCase {
  constructor(
    @Inject(TOKENS.REFRESH_TOKEN_REPOSITORY)
    private refreshTokenRepo: IRefreshTokenRepository,
  ) {}

  async execute(refreshToken: string) {
    await this.refreshTokenRepo.deleteByToken(refreshToken)
  }
}
