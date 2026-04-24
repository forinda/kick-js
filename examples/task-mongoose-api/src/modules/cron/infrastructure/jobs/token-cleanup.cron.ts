import { Service, Autowired, Logger } from '@forinda/kickjs';
import { Cron } from '../../cron.decorator';
import { TOKENS } from '@/shared/constants/tokens';
import type { IRefreshTokenRepository } from '@/modules/auth/domain/repositories/refresh-token.repository';

const logger = Logger.for('CleanupCronJobs');

@Service()
export class CleanupCronJobs {
  @Autowired(TOKENS.REFRESH_TOKEN_REPOSITORY) private tokenRepo!: IRefreshTokenRepository;

  @Cron('0 3 * * *', { description: 'Clean up expired refresh tokens', timezone: 'UTC' })
  async cleanupTokens() {
    logger.info('Running token cleanup...');
    const deleted = await this.tokenRepo.deleteExpired();
    logger.info(`Cleaned up ${deleted} expired refresh tokens`);
  }
}
