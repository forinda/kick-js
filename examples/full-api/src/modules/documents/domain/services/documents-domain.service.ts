import { Service, Inject, HttpException } from '@kickjs/core'
import { DOCUMENTS_REPOSITORY, type IDocumentsRepository } from '../repositories/documents.repository'

@Service()
export class DocumentsDomainService {
  constructor(
    @Inject(DOCUMENTS_REPOSITORY) private readonly repo: IDocumentsRepository,
  ) {}

  async ensureExists(id: string): Promise<void> {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Documents not found')
    }
  }
}
