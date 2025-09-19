import test from 'node:test';
import assert from 'node:assert/strict';
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

test.beforeEach(() => {
  resetControllerRegistry();
  resetAppConfig();
  configureApp({ logging: { level: 'error' } });
});

test('route validation supports zod and joi schemas', async () => {
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
  const expressApp = app as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void };

  const successQueryReq = httpMocks.createRequest<Request>({
    method: 'GET',
    url: '/validate/query',
    query: { name: 'Codex' }
  });
  const successQueryRes = httpMocks.createResponse<Response>({ req: successQueryReq });

  await new Promise<void>((resolve, reject) => {
    const originalEnd = successQueryRes.end;
    successQueryRes.end = ((chunk?: unknown, encoding?: unknown, cb?: () => void) => {
      originalEnd.call(successQueryRes, chunk as never, encoding as never, cb as never);
      resolve();
      return successQueryRes;
    }) as typeof successQueryRes.end;

    expressApp.handle(successQueryReq, successQueryRes, (err?: unknown) => {
      if (err) {
        reject(err);
      }
    });
  });

  assert.equal(successQueryRes.statusCode, 200);
  const successPayload = successQueryRes._getJSONData();
  assert.equal(successPayload.name, 'Codex');

  const failBodyReq = httpMocks.createRequest<Request>({
    method: 'GET',
    url: '/validate/body',
    body: { age: 'old' }
  });
  const failBodyRes = httpMocks.createResponse<Response>({ req: failBodyReq });

  await new Promise<void>((resolve, reject) => {
    const originalEnd = failBodyRes.end;
    failBodyRes.end = ((chunk?: unknown, encoding?: unknown, cb?: () => void) => {
      originalEnd.call(failBodyRes, chunk as never, encoding as never, cb as never);
      resolve();
      return failBodyRes;
    }) as typeof failBodyRes.end;

    expressApp.handle(failBodyReq, failBodyRes, (err?: unknown) => {
      if (err) {
        reject(err);
      }
    });
  });

  assert.equal(failBodyRes.statusCode, 400);
  const errorPayload = failBodyRes._getJSONData();
  assert.equal(errorPayload.error.code, 'VALIDATION_ERROR');

  const requestSnapshots = diagnostics.requests();
  const validatedRequest = requestSnapshots.find((entry) => entry.path.includes('/validate/query'));
  assert.ok(validatedRequest);
  const metadata = validatedRequest?.metadata.ValidationController as Record<string, unknown> | undefined;
  assert.equal(metadata?.queryValidated, true);
});
