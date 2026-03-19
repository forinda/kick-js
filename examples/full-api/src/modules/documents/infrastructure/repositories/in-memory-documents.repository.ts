import { randomUUID } from 'node:crypto'
import { Repository, HttpException } from '@kickjs/core'
import type { IDocumentsRepository } from '../../domain/repositories/documents.repository'
import type { DocumentsResponseDTO } from '../../application/dtos/documents-response.dto'
import type { CreateDocumentsDTO } from '../../application/dtos/create-documents.dto'
import type { UpdateDocumentsDTO } from '../../application/dtos/update-documents.dto'

@Repository()
export class InMemoryDocumentsRepository implements IDocumentsRepository {
  private store = new Map<string, DocumentsResponseDTO>()

  async findById(id: string): Promise<DocumentsResponseDTO | null> {
    return this.store.get(id) ?? null
  }

  async findAll(): Promise<DocumentsResponseDTO[]> {
    return Array.from(this.store.values())
  }

  async create(dto: CreateDocumentsDTO): Promise<DocumentsResponseDTO> {
    const now = new Date().toISOString()
    const entity: DocumentsResponseDTO = {
      id: randomUUID(),
      name: dto.name,
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(entity.id, entity)
    return entity
  }

  async update(id: string, dto: UpdateDocumentsDTO): Promise<DocumentsResponseDTO> {
    const existing = this.store.get(id)
    if (!existing) throw HttpException.notFound('Documents not found')
    const updated = { ...existing, ...dto, updatedAt: new Date().toISOString() }
    this.store.set(id, updated)
    return updated
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) throw HttpException.notFound('Documents not found')
    this.store.delete(id)
  }
}
