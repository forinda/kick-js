import { Service, Inject } from '@kickjs/core'
import { USER_REPOSITORY, type IUserRepository } from '../../domain/repositories/user.repository'
import type { UpdateUserDTO } from '../dtos/update-user.dto'
import type { UserResponseDTO } from '../dtos/user-response.dto'

@Service()
export class UpdateUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly repo: IUserRepository,
  ) {}

  async execute(id: string, dto: UpdateUserDTO): Promise<UserResponseDTO> {
    return this.repo.update(id, dto)
  }
}
