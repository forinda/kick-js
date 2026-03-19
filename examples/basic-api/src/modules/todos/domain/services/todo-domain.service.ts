import { Service, Inject, HttpException } from '@kickjs/core'
import { TODO_REPOSITORY, type ITodoRepository } from '../repositories/todo.repository'
import { Todo } from '../entities/todo.entity'
import { TodoId } from '../value-objects/todo-id.vo'

@Service()
export class TodoDomainService {
  constructor(@Inject(TODO_REPOSITORY) private readonly repo: ITodoRepository) {}

  async createTodo(title: string): Promise<Todo> {
    const todo = Todo.create({ title })
    await this.repo.save(todo)
    return todo
  }

  async toggleTodo(id: string): Promise<Todo> {
    const todoId = TodoId.from(id)
    const todo = await this.repo.findById(todoId)
    if (!todo) throw HttpException.notFound('Todo not found')

    if (todo.completed) {
      todo.markIncomplete()
    } else {
      todo.markCompleted()
    }
    await this.repo.save(todo)
    return todo
  }
}
