import { Service } from '@kickjs/core'
import { TodoDomainService } from '../../domain/services/todo-domain.service'

@Service()
export class ToggleTodoUseCase {
  constructor(private readonly todoService: TodoDomainService) {}

  async execute(id: string) {
    const todo = await this.todoService.toggleTodo(id)
    return todo.toJSON()
  }
}
