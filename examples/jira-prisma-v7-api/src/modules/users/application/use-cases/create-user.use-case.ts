/**
 * Create User Use Case
 *
 * Application layer — orchestrates a single business operation.
 * Use cases are thin: validate input (via DTO), call domain/repo, return response.
 * Keep business rules in the domain service, not here.
 */
import { Service, Inject } from '@forinda/kickjs-core'
import { USER_REPOSITORY, type IUserRepository } from '../../domain/repositories/user.repository'
import type { CreateUserDTO } from '../dtos/create-user.dto'
import type { UserResponseDTO } from '../dtos/user-response.dto'

@Service()
export class CreateUserUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly repo: IUserRepository) {}

  async execute(dto: CreateUserDTO): Promise<UserResponseDTO> {
    return this.repo.create(dto)
  }
}
