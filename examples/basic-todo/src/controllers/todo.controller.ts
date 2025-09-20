import type { Request, Response } from 'express';
import { z } from 'zod';
import { BaseController, Controller, Delete, Get, Inject, Patch, Post } from '../../../../src';
import { TODO_TYPES } from '../domain/todo.types';
import { TodoService } from '../services/todo.service';

const createTodoSchema = z.object({
  title: z.string().min(1, 'Title is required')
});

@Controller('/todos')
export class TodoController extends BaseController {
  constructor(@Inject(TODO_TYPES.TodoService) private readonly todos: TodoService) {
    super();
  }

  protected controllerId(): string {
    return 'TodoController';
  }

  @Get('/')
  list(_req: Request, res: Response) {
    this.logDebug(res, 'Listing todos');
    return this.ok(res, { todos: this.todos.list() });
  }

  @Post({
    path: '/',
    validate: {
      body: createTodoSchema
    }
  })
  create(req: Request, res: Response) {
    const todo = this.todos.create(req.body.title as string);
    this.logInfo(res, 'Todo created', { id: todo.id });
    return this.created(res, todo);
  }

  @Patch({
    path: '/:id/toggle'
  })
  toggle(req: Request, res: Response) {
    const todo = this.todos.toggle(String(req.params.id));
    if (!todo) {
      return this.ok(res, { updated: false });
    }
    this.logInfo(res, 'Todo toggled', { id: todo.id, completed: todo.completed });
    return this.ok(res, todo);
  }

  @Delete('/:id')
  remove(req: Request, res: Response) {
    const deleted = this.todos.remove(String(req.params.id));
    this.logWarn(res, 'Todo removed', { id: req.params.id, deleted });
    return deleted ? this.noContent(res) : this.ok(res, { deleted: false });
  }
}
