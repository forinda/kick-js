import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IProjectRepository } from '../../domain/repositories/project.repository'

@Service()
export class GetProjectUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY)
    private readonly repo: IProjectRepository,
  ) {}

  async execute(id: string) {
    return this.repo.findById(id)
  }
}
