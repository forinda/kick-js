/**
 * Users Repository Interface
 *
 * Domain layer — defines the contract for data access.
 * The interface lives in the domain layer; implementations live in infrastructure.
 * This inversion of dependencies keeps the domain pure and testable.
 *
 * To swap implementations (e.g. in-memory -> Drizzle -> Prisma),
 * change the factory in the module's register() method.
 */
import type { UsersResponseDTO } from '../../application/dtos/users-response.dto'
import type { CreateUsersDTO } from '../../application/dtos/create-users.dto'
import type { UpdateUsersDTO } from '../../application/dtos/update-users.dto'
import type { ParsedQuery } from '@forinda/kickjs-http'

export interface IUsersRepository {
  findById(id: string): Promise<UsersResponseDTO | null>
  findAll(): Promise<UsersResponseDTO[]>
  findPaginated(parsed: ParsedQuery): Promise<{ data: UsersResponseDTO[]; total: number }>
  create(dto: CreateUsersDTO): Promise<UsersResponseDTO>
  createWithPost(dto: CreateUsersDTO): Promise<UsersResponseDTO>
  update(id: string, dto: UpdateUsersDTO): Promise<UsersResponseDTO>
  delete(id: string): Promise<void>
}

export const USERS_REPOSITORY = Symbol('IUsersRepository')
