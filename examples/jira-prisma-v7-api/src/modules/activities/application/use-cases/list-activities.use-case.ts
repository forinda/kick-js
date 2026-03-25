import { Service, Inject } from '@forinda/kickjs-core'
import {
  ACTIVITY_REPOSITORY,
  type IActivityRepository,
} from '../../domain/repositories/activity.repository'
import type { ParsedQuery } from '@forinda/kickjs-http'

@Service()
export class ListActivitiesUseCase {
  constructor(@Inject(ACTIVITY_REPOSITORY) private readonly repo: IActivityRepository) {}

  async execute(
    parsed: ParsedQuery,
    scope: { workspaceId: string; projectId?: string; taskId?: string },
  ) {
    return this.repo.findPaginated(parsed, scope)
  }
}
