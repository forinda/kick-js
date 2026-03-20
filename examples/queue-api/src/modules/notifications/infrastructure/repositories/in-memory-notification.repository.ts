/**
 * In-Memory Notification Repository
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
import type { INotificationRepository } from '../../domain/repositories/notification.repository'
import type { NotificationResponseDTO } from '../../application/dtos/notification-response.dto'
import type { CreateNotificationDTO } from '../../application/dtos/create-notification.dto'
import type { UpdateNotificationDTO } from '../../application/dtos/update-notification.dto'

@Repository()
export class InMemoryNotificationRepository implements INotificationRepository {
  private store = new Map<string, NotificationResponseDTO>()

  async findById(id: string): Promise<NotificationResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<NotificationResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async findPaginated(parsed: ParsedQuery): Promise<{ data: NotificationResponseDTO[]; total: number }> {
    const all = Array.from(this.store.values())
    const data = all.slice(parsed.pagination.offset, parsed.pagination.offset + parsed.pagination.limit)
    return { data, total: all.length }
  }

  async create(dto: CreateNotificationDTO): Promise<NotificationResponseDTO> {
    const now = new Date().toISOString()
    const entity: NotificationResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateNotificationDTO): Promise<NotificationResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Notification not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Notification not found')
    this.store.delete(id)
  }
}
