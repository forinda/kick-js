import { Service, Inject } from '@kickjs/core'
import { DOCUMENTS_REPOSITORY, type IDocumentsRepository } from '../../domain/repositories/documents.repository'
import type { CreateDocumentsDTO } from '../dtos/create-documents.dto'
import type { DocumentsResponseDTO } from '../dtos/documents-response.dto'

@Service()
export class CreateDocumentsUseCase {
  constructor(
    @Inject(DOCUMENTS_REPOSITORY) private readonly repo: IDocumentsRepository,
  ) {}

  async execute(dto: CreateDocumentsDTO): Promise<DocumentsResponseDTO> {
    return this.repo.create(dto)
  }
}
