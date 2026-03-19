import { Service, Inject, HttpException } from '@kickjs/core'
import { TODO_REPOSITORY, type ITodoRepository } from '../../domain/repositories/todo.repository'
import { TodoId } from '../../domain/value-objects/todo-id.vo'

@Service()
export class DeleteTodoUseCase {
  constructor(@Inject(TODO_REPOSITORY) private readonly repo: ITodoRepository) {}

  async execute(id: string) {
    const todoId = TodoId.from(id)
    const existing = await this.repo.findById(todoId)
    if (!existing) throw HttpException.notFound('Todo not found')
    await this.repo.delete(todoId)
  }
}
