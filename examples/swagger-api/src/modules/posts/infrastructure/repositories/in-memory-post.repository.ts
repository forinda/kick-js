/**
 * In-Memory Post Repository
 *
 * Infrastructure layer — implements the repository interface using a Map.
 * Useful for prototyping and testing. Replace with a database implementation
 * (Drizzle, Prisma, etc.) for production use.
 *
 * @Repository() registers this class in the DI container as a singleton.
 */
import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@forinda/kickjs-core'
import type { IPostRepository } from '../../domain/repositories/post.repository'
import type { PostResponseDTO } from '../../application/dtos/post-response.dto'
import type { CreatePostDTO } from '../../application/dtos/create-post.dto'
import type { UpdatePostDTO } from '../../application/dtos/update-post.dto'

@Repository()
export class InMemoryPostRepository implements IPostRepository {
  private store = new Map<string, PostResponseDTO>()

  async findById(id: string): Promise<PostResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<PostResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async create(dto: CreatePostDTO): Promise<PostResponseDTO> {
    const now = new Date().toISOString()
    const entity: PostResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdatePostDTO): Promise<PostResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Post not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Post not found')
    this.store.delete(id)
  }
}
