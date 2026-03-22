import { Service, Inject, HttpException } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import { ErrorCode } from '@/shared/constants/error-codes'
import type { IProjectRepository, Project } from '../repositories/project.repository'

@Service()
export class ProjectDomainService {
  constructor(
    @Inject(TOKENS.PROJECT_REPOSITORY)
    private readonly repo: IProjectRepository,
  ) {}

  async ensureExists(id: string): Promise<Project> {
    const project = await this.repo.findById(id)
    if (!project) {
      throw HttpException.notFound(ErrorCode.PROJECT_NOT_FOUND)
    }
    return project
  }
}
