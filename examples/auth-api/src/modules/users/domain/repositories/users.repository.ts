import type { UsersResponseDTO } from '../../application/dtos/users-response.dto'
import type { CreateUsersDTO } from '../../application/dtos/create-users.dto'
import type { UpdateUsersDTO } from '../../application/dtos/update-users.dto'

export interface IUsersRepository {
  findById(id: string): Promise<UsersResponseDTO | null>
  findByEmail(email: string): Promise<(UsersResponseDTO & { password: string }) | null>
  findAll(): Promise<UsersResponseDTO[]>
  create(dto: CreateUsersDTO): Promise<UsersResponseDTO>
  update(id: string, dto: UpdateUsersDTO): Promise<UsersResponseDTO>
  delete(id: string): Promise<void>
}

export const USERS_REPOSITORY = Symbol('IUsersRepository')
