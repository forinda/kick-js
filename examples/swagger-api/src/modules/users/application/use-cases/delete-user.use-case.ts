import { Service, Inject } from '@kickjs/core'
import { USER_REPOSITORY, type IUserRepository } from '../../domain/repositories/user.repository'

@Service()
export class DeleteUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: IUserRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
