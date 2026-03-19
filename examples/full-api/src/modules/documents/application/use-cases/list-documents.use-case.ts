import { Service, Inject } from '@forinda/kickjs-core'
import { DOCUMENTS_REPOSITORY, type IDocumentsRepository } from '../../domain/repositories/documents.repository'
import type { DocumentsResponseDTO } from '../dtos/documents-response.dto'

@Service()
export class ListDocumentsUseCase {
  constructor(
    @Inject(DOCUMENTS_REPOSITORY) private readonly repo: IDocumentsRepository,
  ) {}

  async execute(): Promise<DocumentsResponseDTO[]> {
    return this.repo.findAll()
  }
}
