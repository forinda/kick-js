import { Service, Inject, HttpException } from '@kickjs/core'
import { TODO_REPOSITORY, type ITodoRepository } from '../../domain/repositories/todo.repository'
import { TodoId } from '../../domain/value-objects/todo-id.vo'

@Service()
export class GetTodoUseCase {
  constructor(@Inject(TODO_REPOSITORY) private readonly repo: ITodoRepository) {}

  async execute(id: string) {
    const todo = await this.repo.findById(TodoId.from(id))
    if (!todo) throw HttpException.notFound('Todo not found')
    return todo.toJSON()
  }
}
