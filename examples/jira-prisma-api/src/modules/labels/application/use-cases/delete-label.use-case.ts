import { Service, Inject } from '@forinda/kickjs-core'
import { LABEL_REPOSITORY, type ILabelRepository } from '../../domain/repositories/label.repository'

@Service()
export class DeleteLabelUseCase {
  constructor(@Inject(LABEL_REPOSITORY) private readonly repo: ILabelRepository) {}

  async execute(id: string) {
    await this.repo.delete(id)
  }
}
