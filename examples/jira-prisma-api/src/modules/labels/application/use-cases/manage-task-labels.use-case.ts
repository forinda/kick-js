import { Service, Inject } from '@forinda/kickjs-core'
import {
  TASK_LABEL_REPOSITORY,
  type ITaskLabelRepository,
} from '../../domain/repositories/task-label.repository'

@Service()
export class ManageTaskLabelsUseCase {
  constructor(@Inject(TASK_LABEL_REPOSITORY) private readonly repo: ITaskLabelRepository) {}

  async getLabels(taskId: string) {
    return this.repo.findByTask(taskId)
  }

  async addLabel(taskId: string, labelId: string) {
    return this.repo.add(taskId, labelId)
  }

  async removeLabel(taskId: string, labelId: string) {
    await this.repo.remove(taskId, labelId)
  }
}
