import type { DocumentsResponseDTO } from '../../application/dtos/documents-response.dto'
import type { CreateDocumentsDTO } from '../../application/dtos/create-documents.dto'
import type { UpdateDocumentsDTO } from '../../application/dtos/update-documents.dto'

export interface IDocumentsRepository {
  findById(id: string): Promise<DocumentsResponseDTO | null>
  findAll(): Promise<DocumentsResponseDTO[]>
  create(dto: CreateDocumentsDTO): Promise<DocumentsResponseDTO>
  update(id: string, dto: UpdateDocumentsDTO): Promise<DocumentsResponseDTO>
  delete(id: string): Promise<void>
}

export const DOCUMENTS_REPOSITORY = Symbol('IDocumentsRepository')
