import { Controller, Get, Post, Put, Delete, Autowired } from '@forinda/kickjs-core'
import { RequestContext } from '@forinda/kickjs-http'
import { ApiTags, ApiOperation, ApiResponse } from '@forinda/kickjs-swagger'
import { CreateTodoUseCase } from '../application/use-cases/create-todo.use-case'
import { ListTodosUseCase } from '../application/use-cases/list-todos.use-case'
import { GetTodoUseCase } from '../application/use-cases/get-todo.use-case'
import { ToggleTodoUseCase } from '../application/use-cases/toggle-todo.use-case'
import { DeleteTodoUseCase } from '../application/use-cases/delete-todo.use-case'
import { createTodoSchema } from '../application/dtos/create-todo.dto'

@Controller()
@ApiTags('Todos')
export class TodoController {
  @Autowired() private createTodoUseCase!: CreateTodoUseCase
  @Autowired() private listTodosUseCase!: ListTodosUseCase
  @Autowired() private getTodoUseCase!: GetTodoUseCase
  @Autowired() private toggleTodoUseCase!: ToggleTodoUseCase
  @Autowired() private deleteTodoUseCase!: DeleteTodoUseCase

  @Post('/', { body: createTodoSchema })
  @ApiOperation({ summary: 'Create a new todo' })
  @ApiResponse({ status: 201, description: 'Todo created' })
  @ApiResponse({ status: 422, description: 'Validation error' })
  async create(ctx: RequestContext) {
    const result = await this.createTodoUseCase.execute(ctx.body)
    ctx.created(result)
  }

  @Get('/')
  @ApiOperation({ summary: 'List all todos' })
  @ApiResponse({ status: 200, description: 'List of todos' })
  async list(ctx: RequestContext) {
    const result = await this.listTodosUseCase.execute()
    ctx.json(result)
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get a todo by ID' })
  @ApiResponse({ status: 200, description: 'Todo found' })
  @ApiResponse({ status: 404, description: 'Todo not found' })
  async getById(ctx: RequestContext) {
    const result = await this.getTodoUseCase.execute(ctx.params.id)
    ctx.json(result)
  }

  @Put('/:id/toggle')
  @ApiOperation({ summary: 'Toggle todo completed status' })
  @ApiResponse({ status: 200, description: 'Todo toggled' })
  @ApiResponse({ status: 404, description: 'Todo not found' })
  async toggle(ctx: RequestContext) {
    const result = await this.toggleTodoUseCase.execute(ctx.params.id)
    ctx.json(result)
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete a todo' })
  @ApiResponse({ status: 204, description: 'Todo deleted' })
  @ApiResponse({ status: 404, description: 'Todo not found' })
  async remove(ctx: RequestContext) {
    await this.deleteTodoUseCase.execute(ctx.params.id)
    ctx.noContent()
  }
}
