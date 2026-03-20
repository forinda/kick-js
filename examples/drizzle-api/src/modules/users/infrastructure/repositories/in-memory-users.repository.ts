/**
 * In-Memory Users Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { IUsersRepository } from '../../domain/repositories/users.repository'
import type { UsersResponseDTO } from '../../application/dtos/users-response.dto'
import type { CreateUsersDTO } from '../../application/dtos/create-users.dto'
import type { UpdateUsersDTO } from '../../application/dtos/update-users.dto'

@Repository()
export class InMemoryUsersRepository implements IUsersRepository {
  private store = new Map<string, UsersResponseDTO>()

  async findById(id: string): Promise<UsersResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<UsersResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async create(dto: CreateUsersDTO): Promise<UsersResponseDTO> {
    const now = new Date().toISOString()
    const entity: UsersResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateUsersDTO): Promise<UsersResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Users not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Users not found')
    this.store.delete(id)
  }
}
