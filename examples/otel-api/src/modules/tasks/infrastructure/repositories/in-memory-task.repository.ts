/**
 * In-Memory Task Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { ParsedQuery } from '@forinda/kickjs-http'
import type { ITaskRepository } from '../../domain/repositories/task.repository'
import type { TaskResponseDTO } from '../../application/dtos/task-response.dto'
import type { CreateTaskDTO } from '../../application/dtos/create-task.dto'
import type { UpdateTaskDTO } from '../../application/dtos/update-task.dto'

@Repository()
export class InMemoryTaskRepository implements ITaskRepository {
  private store = new Map<string, TaskResponseDTO>()

  async findById(id: string): Promise<TaskResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<TaskResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: TaskResponseDTO[]; total: number }> {
    const all = Array.from(this.store.values())
    const data = all.slice(parsed.pagination.offset, parsed.pagination.offset + parsed.pagination.limit)
    return { data, total: all.length }
  }

  async create(dto: CreateTaskDTO): Promise<TaskResponseDTO> {
    const now = new Date().toISOString()
    const entity: TaskResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateTaskDTO): Promise<TaskResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Task not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Task not found')
    this.store.delete(id)
  }
}
