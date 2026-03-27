import { Service, Inject } from '@forinda/kickjs'
import { STATS_REPOSITORY, type IStatsRepository } from '../../domain/repositories/stat.repository'

@Service()
export class GetWorkspaceStatsUseCase {
  constructor(@Inject(STATS_REPOSITORY) private readonly repo: IStatsRepository) {}

  async execute(workspaceId: string) {
    return this.repo.getWorkspaceStats(workspaceId)
  }
}
