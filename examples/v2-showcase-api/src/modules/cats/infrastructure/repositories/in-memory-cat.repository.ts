/**
 * In-Memory Cat Repository
 *
 * Implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs'
import type { ParsedQuery } from '@forinda/kickjs'
import type { ICatRepository } from '../../domain/repositories/cat.repository'
import type { CatResponseDTO } from '../../application/dtos/cat-response.dto'
import type { CreateCatDTO } from '../../application/dtos/create-cat.dto'
import type { UpdateCatDTO } from '../../application/dtos/update-cat.dto'

@Repository()
export class InMemoryCatRepository implements ICatRepository {
  private store = new Map<string, CatResponseDTO>()

  async findById(id: string): Promise<CatResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<CatResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: CatResponseDTO[]; total: number }> {
    const all = Array.from(this.store.values())
    const data = all.slice(parsed.pagination.offset, parsed.pagination.offset + parsed.pagination.limit)
    return { data, total: all.length }
  }

  async create(dto: CreateCatDTO): Promise<CatResponseDTO> {
    const now = new Date().toISOString()
    const entity: CatResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateCatDTO): Promise<CatResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Cat not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Cat not found')
    this.store.delete(id)
  }
}
