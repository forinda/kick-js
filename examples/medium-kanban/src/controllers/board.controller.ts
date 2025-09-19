import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  BaseController,
  Controller,
  Delete,
  Get,
  Inject,
  Patch,
  Post,
  RequestTracker,
  TYPES
} from '../../../../src';
import { BoardService } from '../services/board.service';
import { KANBAN_TYPES } from '../domain/board.types';

const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional()
});

const transitionSchema = z.object({
  direction: z.enum(['forward', 'back'])
});

@Controller('/board')
export class BoardController extends BaseController {
  constructor(
    @Inject(TYPES.RequestTracker) tracker: RequestTracker,
    @Inject(KANBAN_TYPES.BoardService) private readonly board: BoardService
  ) {
    super(tracker);
  }

  protected controllerId(): string {
    return 'BoardController';
  }

  @Get('/tasks')
  list(_req: Request, res: Response) {
    const state = this.board.list();
    this.mergeRequestMetadata(res, { taskCount: state.tasks.length });
    return this.ok(res, state);
  }

  @Post({
    path: '/tasks',
    validate: {
      body: createTaskSchema
    }
  })
  create(req: Request, res: Response) {
    const task = this.board.create({
      title: req.body.title as string,
      description: req.body.description as string | undefined
    });
    this.logInfo(res, 'Task created', { id: task.id });
    return this.created(res, task);
  }

  @Patch({
    path: '/tasks/:id/transition',
    validate: {
      body: transitionSchema
    }
  })
  transition(req: Request, res: Response) {
    const direction = req.body.direction as 'forward' | 'back';
    const task =
      direction === 'forward'
        ? this.board.advance(String(req.params.id))
        : this.board.revert(String(req.params.id));

    if (!task) {
      return this.ok(res, { updated: false });
    }

    this.logInfo(res, 'Task transitioned', { id: task.id, status: task.status });
    return this.ok(res, task);
  }

  @Delete('/tasks/:id')
  remove(req: Request, res: Response) {
    const deleted = this.board.remove(String(req.params.id));
    this.logWarn(res, 'Task removed', { id: req.params.id, deleted });
    return deleted ? this.noContent(res) : this.ok(res, { deleted: false });
  }
}
