import { Service, Inject } from '@forinda/kickjs'
import { LABEL_REPOSITORY, type ILabelRepository } from '../../domain/repositories/label.repository'
import type { UpdateLabelDTO } from '../dtos/update-label.dto'

@Service()
export class UpdateLabelUseCase {
  constructor(@Inject(LABEL_REPOSITORY) private readonly repo: ILabelRepository) {}

  async execute(id: string, dto: UpdateLabelDTO) {
    return this.repo.update(id, dto)
  }
}
