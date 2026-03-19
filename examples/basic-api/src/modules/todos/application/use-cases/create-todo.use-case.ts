import { Service } from '@kickjs/core'
import { TodoDomainService } from '../../domain/services/todo-domain.service'
import type { CreateTodoDTO } from '../dtos/create-todo.dto'

@Service()
export class CreateTodoUseCase {
  constructor(private readonly todoService: TodoDomainService) {}

  async execute(dto: CreateTodoDTO) {
    const todo = await this.todoService.createTodo(dto.title)
    return todo.toJSON()
  }
}
