import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { LABEL_REPOSITORY, type ILabelRepository } from '../repositories/label.repository'

@Service()
export class LabelDomainService {
  constructor(@Inject(LABEL_REPOSITORY) private readonly repo: ILabelRepository) {}

  async ensureExists(id: string) {
    const entity = await this.repo.findById(id)
    if (!entity) {
      throw HttpException.notFound('Label not found')
    }
    return entity
  }
}
