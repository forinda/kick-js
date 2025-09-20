import type { Request, Response } from 'express';
import { z } from 'zod';
import { BaseController, Controller, Get, Inject, Post } from '../../../../src';
import { EventService } from '../services/event.service';
import { ANALYTICS_TYPES } from '../domain/analytics.types';

const recordSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({})
});

const historyQuerySchema = z.object({
  type: z.string().optional(),
  since: z
    .preprocess((value) => (value ? Number(value) : undefined), z.number().nonnegative())
    .optional()
});

@Controller('/analytics')
export class EventController extends BaseController {
  constructor(@Inject(ANALYTICS_TYPES.EventService) private readonly events: EventService) {
    super();
  }

  protected controllerId(): string {
    return 'EventController';
  }

  @Post({
    path: '/events',
    validate: {
      body: recordSchema
    }
  })
  record(req: Request, res: Response) {
    const event = this.events.record(req.body.type as string, (req.body.payload ?? {}) as Record<string, unknown>);
    this.logInfo(res, 'Analytics event recorded', { id: event.id, type: event.type });
    this.mergeRequestMetadata(res, { eventType: event.type });
    return this.created(res, event);
  }

  @Get('/metrics')
  metrics(_req: Request, res: Response) {
    return this.ok(res, this.events.metrics());
  }

  @Get({
    path: '/events',
    validate: {
      query: historyQuerySchema
    }
  })
  history(req: Request, res: Response) {
    const filter = {
      type: typeof req.query.type === 'string' ? req.query.type : undefined,
      since: typeof req.query.since === 'number' ? (req.query.since as number) : undefined
    };

    return this.ok(res, { events: this.events.history(filter) });
  }
}
