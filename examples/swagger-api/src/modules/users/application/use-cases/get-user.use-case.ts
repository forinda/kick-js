import { Service, Inject } from '@kickjs/core'
import { USER_REPOSITORY, type IUserRepository } from '../../domain/repositories/user.repository'
import type { UserResponseDTO } from '../dtos/user-response.dto'

@Service()
export class GetUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: IUserRepository,
  ) {}

  async execute(id: string): Promise<UserResponseDTO | null> {
    return this.repo.findById(id)
  }
}
