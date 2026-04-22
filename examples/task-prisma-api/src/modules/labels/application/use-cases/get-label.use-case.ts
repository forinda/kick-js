import { Service, Inject } from '@forinda/kickjs'
import { LABEL_REPOSITORY, type ILabelRepository } from '../../domain/repositories/label.repository'

@Service()
export class GetLabelUseCase {
  constructor(@Inject(LABEL_REPOSITORY) private readonly repo: ILabelRepository) {}

  async execute(id: string) {
    return this.repo.findById(id)
  }
}
