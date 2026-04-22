import { Service, Inject } from '@forinda/kickjs'
import { LABEL_REPOSITORY, type ILabelRepository } from '../../domain/repositories/label.repository'
import type { ParsedQuery } from '@forinda/kickjs'

@Service()
export class ListLabelsUseCase {
  constructor(@Inject(LABEL_REPOSITORY) private readonly repo: ILabelRepository) {}

  async execute(parsed: ParsedQuery, workspaceId?: string) {
    return this.repo.findPaginated(parsed, workspaceId)
  }
}
