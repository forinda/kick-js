import { Container, type AppModule, type ModuleRoutes } from '@forinda/kickjs-core'
import { buildRoutes } from '@forinda/kickjs-http'
import { TODO_REPOSITORY } from './domain/repositories/todo.repository'
import { InMemoryTodoRepository } from './infrastructure/repositories/in-memory-todo.repository'
import { TodoController } from './presentation/todo.controller'

// Eagerly load services and use-cases so @Service() decorators register in the container
import './domain/services/todo-domain.service'
import './application/use-cases/create-todo.use-case'
import './application/use-cases/list-todos.use-case'
import './application/use-cases/get-todo.use-case'
import './application/use-cases/toggle-todo.use-case'
import './application/use-cases/delete-todo.use-case'

export class TodoModule implements AppModule {
  register(container: Container): void {
    // Bind the repository interface token to the in-memory implementation
    container.registerFactory(TODO_REPOSITORY, () => container.resolve(InMemoryTodoRepository))
  }

  routes(): ModuleRoutes {
    return {
      path: '/todos',
      router: buildRoutes(TodoController),
      controller: TodoController,
    }
  }
}
