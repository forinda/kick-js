import { Service, Inject } from '@forinda/kickjs';
import { TOKENS } from '@/shared/constants/tokens';
import type { IUserRepository } from '../../domain/repositories/user.repository';

@Service()
export class ListUsersUseCase {
  constructor(
    @Inject(TOKENS.USER_REPOSITORY) private userRepo: IUserRepository,
  ) {}

  async execute(parsed: any) {
    return this.userRepo.findPaginated(parsed);
  }
}
