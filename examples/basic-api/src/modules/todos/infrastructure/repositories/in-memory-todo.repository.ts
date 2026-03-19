import { Repository } from '@kickjs/core'
import type { ITodoRepository } from '../../domain/repositories/todo.repository'
import { Todo } from '../../domain/entities/todo.entity'
import type { TodoId } from '../../domain/value-objects/todo-id.vo'

@Repository()
export class InMemoryTodoRepository implements ITodoRepository {
  private store = new Map<string, Todo>()

  async findById(id: TodoId): Promise<Todo | null> {
    return this.store.get(id.toString()) ?? null
  }

  async findAll(): Promise<Todo[]> {
    return Array.from(this.store.values())
  }

  async save(todo: Todo): Promise<void> {
    this.store.set(todo.id.toString(), todo)
  }

  async delete(id: TodoId): Promise<void> {
    this.store.delete(id.toString())
  }
}
