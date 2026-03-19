import { Service, Inject } from '@forinda/kickjs-core'
import { USERS_REPOSITORY, type IUsersRepository } from '../../domain/repositories/users.repository'

@Service()
export class DeleteUsersUseCase {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly repo: IUsersRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
