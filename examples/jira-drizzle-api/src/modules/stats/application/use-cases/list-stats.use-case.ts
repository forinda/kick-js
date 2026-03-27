import { Service, Inject } from '@forinda/kickjs-core'
import { STATS_REPOSITORY, type IStatsRepository } from '../../domain/repositories/stat.repository'

@Service()
export class GetProjectStatsUseCase {
  constructor(@Inject(STATS_REPOSITORY) private readonly repo: IStatsRepository) {}

  async execute(projectId: string) {
    return this.repo.getProjectStats(projectId)
  }
}
