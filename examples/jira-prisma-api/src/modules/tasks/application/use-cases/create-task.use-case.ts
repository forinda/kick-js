import { Service, Inject } from '@forinda/kickjs'
import { TOKENS } from '@/shared/constants/tokens'
import type { ITaskRepository } from '../../domain/repositories/task.repository'
import type { ITaskAssigneeRepository } from '../../domain/repositories/task-assignee.repository'
import type { IProjectRepository } from '@/modules/projects/domain/repositories/project.repository'
import type { CreateTaskDTO } from '../dtos/create-task.dto'

@Service()
export class CreateTaskUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY)
    private readonly taskRepo: ITaskRepository,
    @Inject(TOKENS.TASK_ASSIGNEE_REPOSITORY)
    private readonly assigneeRepo: ITaskAssigneeRepository,
    @Inject(TOKENS.PROJECT_REPOSITORY)
    private readonly projectRepo: IProjectRepository,
  ) {}

  async execute(dto: CreateTaskDTO, reporterId: string) {
    // Atomic task key generation
    const counter = await this.projectRepo.incrementTaskCounter(dto.projectId)
    const key = `${counter.key}-${counter.taskCounter}`

    const { assigneeIds, ...taskData } = dto

    const task = await this.taskRepo.create({
      ...taskData,
      key,
      reporterId,
    })

    if (assigneeIds.length > 0) {
      await this.assigneeRepo.addMany(task.id, assigneeIds)
    }

    return task
  }
}
