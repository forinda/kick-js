import { Service, Inject } from '@kickjs/core'
import { DOCUMENTS_REPOSITORY, type IDocumentsRepository } from '../../domain/repositories/documents.repository'
import type { DocumentsResponseDTO } from '../dtos/documents-response.dto'

@Service()
export class GetDocumentsUseCase {
  constructor(
    @Inject(DOCUMENTS_REPOSITORY) private readonly repo: IDocumentsRepository,
  ) {}

  async execute(id: string): Promise<DocumentsResponseDTO | null> {
    return this.repo.findById(id)
  }
}
