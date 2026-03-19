/**
 * In-Memory User Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { IUserRepository } from '../../domain/repositories/user.repository'
import type { UserResponseDTO } from '../../application/dtos/user-response.dto'
import type { CreateUserDTO } from '../../application/dtos/create-user.dto'
import type { UpdateUserDTO } from '../../application/dtos/update-user.dto'

@Repository()
export class InMemoryUserRepository implements IUserRepository {
  private store = new Map<string, UserResponseDTO>()

  async findById(id: string): Promise<UserResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<UserResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async create(dto: CreateUserDTO): Promise<UserResponseDTO> {
    const now = new Date().toISOString()
    const entity: UserResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateUserDTO): Promise<UserResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('User not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('User not found')
    this.store.delete(id)
  }
}
