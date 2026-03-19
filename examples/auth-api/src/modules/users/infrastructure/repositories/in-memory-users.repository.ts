import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@kickjs/core'
import type { IUsersRepository } from '../../domain/repositories/users.repository'
import type { UsersResponseDTO } from '../../application/dtos/users-response.dto'
import type { CreateUsersDTO } from '../../application/dtos/create-users.dto'
import type { UpdateUsersDTO } from '../../application/dtos/update-users.dto'

interface StoredUser extends UsersResponseDTO {
  password: string
}

@Repository()
export class InMemoryUsersRepository implements IUsersRepository {
  private store = new Map<string, StoredUser>()

  async findById(id: string): Promise<UsersResponseDTO | null> {
    const user = this.store.get(id)
    if (!user) return null
    return this.toResponse(user)
  }

  async findByEmail(email: string): Promise<StoredUser | null> {
    for (const user of this.store.values()) {
      if (user.email === email) return user
    }
    return null
  }

  async findAll(): Promise<UsersResponseDTO[]> {
    return Array.from(this.store.values()).map((u) => this.toResponse(u))
  }

  async create(dto: CreateUsersDTO): Promise<UsersResponseDTO> {
    const now = new Date().toISOString()
    const entity: StoredUser = {
      id: randomUUID(),
      name: dto.name,
      email: dto.email,
      password: dto.password,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return this.toResponse(entity)
  }

  async update(id: string, dto: UpdateUsersDTO): Promise<UsersResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Users not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return this.toResponse(updated)
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Users not found')
    this.store.delete(id)
  }

  private toResponse(user: StoredUser): UsersResponseDTO {
    const { password: _, ...rest } = user
    return rest
  }
}
