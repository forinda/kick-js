import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { ITaskAssigneeRepository } from '../../domain/repositories/task-assignee.repository'

@Service()
export class ManageAssigneesUseCase {
  constructor(
    @Inject(TOKENS.TASK_ASSIGNEE_REPOSITORY)
    private readonly assigneeRepo: ITaskAssigneeRepository,
  ) {}

  async addAssignee(taskId: string, userId: string) {
    return this.assigneeRepo.add(taskId, userId)
  }

  async removeAssignee(taskId: string, userId: string) {
    await this.assigneeRepo.remove(taskId, userId)
  }

  async getAssignees(taskId: string) {
    return this.assigneeRepo.findByTask(taskId)
  }
}
