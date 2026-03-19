/**
 * User Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { UserResponseDTO } from '../../application/dtos/user-response.dto'
import type { CreateUserDTO } from '../../application/dtos/create-user.dto'
import type { UpdateUserDTO } from '../../application/dtos/update-user.dto'

export interface IUserRepository {
  findById(id: string): Promise<UserResponseDTO | null>
  findAll(): Promise<UserResponseDTO[]>
  create(dto: CreateUserDTO): Promise<UserResponseDTO>
  update(id: string, dto: UpdateUserDTO): Promise<UserResponseDTO>
  delete(id: string): Promise<void>
}

export const USER_REPOSITORY = Symbol('IUserRepository')
