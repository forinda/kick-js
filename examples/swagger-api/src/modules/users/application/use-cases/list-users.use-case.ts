import { Service, Inject } from '@kickjs/core'
import { USER_REPOSITORY, type IUserRepository } from '../../domain/repositories/user.repository'
import type { UserResponseDTO } from '../dtos/user-response.dto'

@Service()
export class ListUsersUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: IUserRepository,
  ) {}

  async execute(): Promise<UserResponseDTO[]> {
    return this.repo.findAll()
  }
}
