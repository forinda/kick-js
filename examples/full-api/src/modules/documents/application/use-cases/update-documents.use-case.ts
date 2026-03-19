import { Service, Inject } from '@forinda/kickjs-core'
import { DOCUMENTS_REPOSITORY, type IDocumentsRepository } from '../../domain/repositories/documents.repository'
import type { UpdateDocumentsDTO } from '../dtos/update-documents.dto'
import type { DocumentsResponseDTO } from '../dtos/documents-response.dto'

@Service()
export class UpdateDocumentsUseCase {
  constructor(
    @Inject(DOCUMENTS_REPOSITORY) private readonly repo: IDocumentsRepository,
  ) {}

  async execute(id: string, dto: UpdateDocumentsDTO): Promise<DocumentsResponseDTO> {
    return this.repo.update(id, dto)
  }
}
