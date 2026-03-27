import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { IProjectRepository } from '../../domain/repositories/project.repository'

@Service()
export class DeleteProjectUseCase {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY)
    private readonly repo: IProjectRepository,
  ) {}

  async execute(id: string) {
    await this.repo.delete(id)
  }
}
