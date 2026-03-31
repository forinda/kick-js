import { Service, Inject, createLogger } from '@forinda/kickjs'
import {
  TASK_REPOSITORY,
  type ITaskRepository,
  type CreateTaskDto,
  type UpdateTaskDto,
} from '../domain/task.entity'

const log = createLogger('TaskService')

@Service()
export class TaskService {
  constructor(@Inject(TASK_REPOSITORY) private readonly repo: ITaskRepository) {}

  async list() {
    log.info('Listing all tasks')
    return this.repo.findAll()
  }

  async get(id: string) {
    return this.repo.findById(id)
  }

  async create(dto: CreateTaskDto) {
    log.info(`Creating task: ${dto.title}`)
    return this.repo.create(dto)
  }

  async update(id: string, dto: UpdateTaskDto) {
    return this.repo.update(id, dto)
  }

  async remove(id: string) {
    return this.repo.delete(id)
  }
}
