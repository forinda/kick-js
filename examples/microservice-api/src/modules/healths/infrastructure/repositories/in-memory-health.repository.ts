/**
 * In-Memory Health Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { IHealthRepository } from '../../domain/repositories/health.repository'
import type { HealthResponseDTO } from '../../application/dtos/health-response.dto'
import type { CreateHealthDTO } from '../../application/dtos/create-health.dto'
import type { UpdateHealthDTO } from '../../application/dtos/update-health.dto'

@Repository()
export class InMemoryHealthRepository implements IHealthRepository {
  private store = new Map<string, HealthResponseDTO>()

  async findById(id: string): Promise<HealthResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<HealthResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: HealthResponseDTO[]; total: number }> {
    const all = Array.from(this.store.values())
    const data = all.slice(parsed.pagination.offset, parsed.pagination.offset + parsed.pagination.limit)
    return { data, total: all.length }
  }

  async create(dto: CreateHealthDTO): Promise<HealthResponseDTO> {
    const now = new Date().toISOString()
    const entity: HealthResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateHealthDTO): Promise<HealthResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Health not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Health not found')
    this.store.delete(id)
  }
}
