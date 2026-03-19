import type { Todo } from '../entities/todo.entity'
import type { TodoId } from '../value-objects/todo-id.vo'

export interface ITodoRepository {
  findById(id: TodoId): Promise<Todo | null>
  findAll(): Promise<Todo[]>
  save(todo: Todo): Promise<void>
  delete(id: TodoId): Promise<void>
}

export const TODO_REPOSITORY = Symbol('ITodoRepository')
