import { Service, Inject } from '@forinda/kickjs-core'
import { TOKENS } from '@/shared/constants/tokens'
import type { ITaskRepository } from '../../domain/repositories/task.repository'
import type { UpdateTaskDTO } from '../dtos/update-task.dto'

@Service()
export class UpdateTaskUseCase {
  constructor(
    @Inject(TOKENS.TASK_REPOSITORY)
    private readonly repo: ITaskRepository,
  ) {}

  async execute(id: string, dto: UpdateTaskDTO) {
    return this.repo.update(id, dto)
  }
}
