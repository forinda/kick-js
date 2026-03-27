/**
 * In-Memory Products Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs'
import type { IProductsRepository } from '../../domain/repositories/products.repository'
import type { ProductsResponseDTO } from '../../application/dtos/products-response.dto'
import type { CreateProductsDTO } from '../../application/dtos/create-products.dto'
import type { UpdateProductsDTO } from '../../application/dtos/update-products.dto'

@Repository()
export class InMemoryProductsRepository implements IProductsRepository {
  private store = new Map<string, ProductsResponseDTO>()

  async findById(id: string): Promise<ProductsResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<ProductsResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async create(dto: CreateProductsDTO): Promise<ProductsResponseDTO> {
    const now = new Date().toISOString()
    const entity: ProductsResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateProductsDTO): Promise<ProductsResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Products not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Products not found')
    this.store.delete(id)
  }
}
