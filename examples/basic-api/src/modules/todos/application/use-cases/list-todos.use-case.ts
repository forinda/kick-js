import { Service, Inject } from '@kickjs/core'
import { TODO_REPOSITORY, type ITodoRepository } from '../../domain/repositories/todo.repository'

@Service()
export class ListTodosUseCase {
  constructor(@Inject(TODO_REPOSITORY) private readonly repo: ITodoRepository) {}

  async execute() {
    const todos = await this.repo.findAll()
    return todos.map((t) => t.toJSON())
  }
}
