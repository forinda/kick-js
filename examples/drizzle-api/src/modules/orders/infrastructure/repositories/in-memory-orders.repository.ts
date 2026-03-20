/**
 * In-Memory Orders Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { IOrdersRepository } from '../../domain/repositories/orders.repository'
import type { OrdersResponseDTO } from '../../application/dtos/orders-response.dto'
import type { CreateOrdersDTO } from '../../application/dtos/create-orders.dto'
import type { UpdateOrdersDTO } from '../../application/dtos/update-orders.dto'

@Repository()
export class InMemoryOrdersRepository implements IOrdersRepository {
  private store = new Map<string, OrdersResponseDTO>()

  async findById(id: string): Promise<OrdersResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<OrdersResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async create(dto: CreateOrdersDTO): Promise<OrdersResponseDTO> {
    const now = new Date().toISOString()
    const entity: OrdersResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateOrdersDTO): Promise<OrdersResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Orders not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Orders not found')
    this.store.delete(id)
  }
}
