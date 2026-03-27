import { Service, Inject } from '@forinda/kickjs-core'
import { LABEL_REPOSITORY, type ILabelRepository } from '../../domain/repositories/label.repository'
import type { CreateLabelDTO } from '../dtos/create-label.dto'

@Service()
export class CreateLabelUseCase {
  constructor(@Inject(LABEL_REPOSITORY) private readonly repo: ILabelRepository) {}

  async execute(dto: CreateLabelDTO) {
    return this.repo.create(dto)
  }
}
