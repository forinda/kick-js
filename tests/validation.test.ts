import { beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import httpMocks from 'node-mocks-http';
import type { Request, Response } from 'express';
import { z } from 'zod';
import Joi from 'joi';

import {
  BaseController,
  Controller,
  Get,
  Inject,
  RequestTracker,
  TYPES,
  createApp,
  configureApp,
  resetControllerRegistry,
  resetAppConfig
} from '../src';

async function dispatch(app: unknown, options: Parameters<typeof httpMocks.createRequest>[0]) {
  const expressApp = app as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void };
  const req = httpMocks.createRequest<Request>(options);
  const res = httpMocks.createResponse<Response>({ req });

  await new Promise<void>((resolve, reject) => {
    const originalEnd = res.end;
    res.end = ((chunk?: unknown, encoding?: unknown, cb?: () => void) => {
      originalEnd.call(res, chunk as never, encoding as never, cb as never);
      resolve();
      return res;
    }) as typeof res.end;

    res.on('error', (err) => reject(err));

    expressApp.handle(req, res, (err?: unknown) => {
      if (err) {
        reject(err);
      }
    });
  });

  return res;
}

describe('validation', () => {
  beforeEach(() => {
    resetControllerRegistry();
    resetAppConfig();
    configureApp({ logging: { level: 'error' } });
  });

  it('supports zod and joi schemas', async () => {
    @Controller('/validate')
    class ValidationController extends BaseController {
      constructor(@Inject(TYPES.RequestTracker) tracker: RequestTracker) {
        super(tracker);
      }

      protected controllerId(): string {
        return 'ValidationController';
      }

      @Get({
        path: '/query',
        validate: {
          query: z.object({ name: z.string() })
        }
      })
      queryRoute(req: Request, res: Response) {
        this.mergeRequestMetadata(res, { queryValidated: true });
        return this.ok(res, { name: req.query.name });
      }

      @Get({
        path: '/body',
        validate: {
          body: Joi.object({ age: Joi.number().integer().min(0).required() })
        }
      })
      bodyRoute(req: Request, res: Response) {
        this.mergeRequestMetadata(res, { bodyValidated: true });
        return this.ok(res, { age: req.body.age });
      }
    }

    const { app, diagnostics } = createApp();

    const successResponse = await dispatch(app, {
      method: 'GET',
      url: '/validate/query',
      query: { name: 'Codex' }
    });

    expect(successResponse.statusCode).toBe(200);
    expect(successResponse._getJSONData().name).toBe('Codex');

    const failureResponse = await dispatch(app, {
      method: 'GET',
      url: '/validate/body',
      body: { age: 'old' }
    });

    expect(failureResponse.statusCode).toBe(400);
    expect(failureResponse._getJSONData().error.code).toBe('VALIDATION_ERROR');

    const requestSnapshots = diagnostics.requests();
    const validatedRequest = requestSnapshots.find((entry) => entry.path.includes('/validate/query'));
    expect(validatedRequest).toBeDefined();
    const metadata = validatedRequest?.metadata.ValidationController as Record<string, unknown> | undefined;
    expect(metadata?.queryValidated).toBe(true);
  });
});
