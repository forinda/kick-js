import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IProjectRepository } from '../../domain/repositories/project.repository'
import type { UpdateProjectDTO } from '../dtos/update-project.dto'

@Service()
export class UpdateProjectUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY)
    private readonly repo: IProjectRepository,
  ) {}

  async execute(id: string, dto: UpdateProjectDTO) {
    return this.repo.update(id, dto)
  }
}
