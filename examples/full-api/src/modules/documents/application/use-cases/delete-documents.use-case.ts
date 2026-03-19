import { Service, Inject } from '@kickjs/core'
import { DOCUMENTS_REPOSITORY, type IDocumentsRepository } from '../../domain/repositories/documents.repository'

@Service()
export class DeleteDocumentsUseCase {
  constructor(
    @Inject(DOCUMENTS_REPOSITORY) private readonly repo: IDocumentsRepository,
  ) {}

  async execute(id: string): Promise<void> {
    await this.repo.delete(id)
  }
}
