import test from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import httpMocks from 'node-mocks-http';
import type { Request, Response } from 'express';

import {
  BaseController,
  Controller,
  Get,
  Inject,
  RequestTracker,
  TYPES,
  createApp,
  createError,
  isAppError,
  configureApp,
  resetControllerRegistry,
  resetAppConfig
} from '../src';

test.beforeEach(() => {
  resetControllerRegistry();
  resetAppConfig();
  configureApp({ logging: { level: 'error' } });
});

test('AppError helpers propagate structured codes through the pipeline', async () => {
  @Controller('/fail')
  class FailController extends BaseController {
    constructor(@Inject(TYPES.RequestTracker) tracker: RequestTracker) {
      super(tracker);
    }

    protected controllerId(): string {
      return 'FailController';
    }

    @Get('/')
    handle(_req: Request, res: Response) {
      this.logWarn(res, 'About to fail');
      this.fail('TEST_ERROR', 'Custom failure', {
        status: 418,
        details: { culprit: 'unit-test' }
      });
    }
  }

  const { app, diagnostics } = createApp();
  const expressApp = app as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void };

  const req = httpMocks.createRequest<Request>({
    method: 'GET',
    url: '/fail/'
  });
  const res = httpMocks.createResponse<Response>({ req });

  await new Promise<void>((resolve, reject) => {
    const originalEnd = res.end;
    res.end = ((chunk?: unknown, encoding?: unknown, cb?: () => void) => {
      originalEnd.call(res, chunk as never, encoding as never, cb as never);
      resolve();
      return res;
    }) as typeof res.end;

    expressApp.handle(req, res, (err?: unknown) => {
      if (err) {
        reject(err);
      }
    });
  });

  assert.equal(res.statusCode, 418);
  const payload = res._getJSONData();
  assert.equal(payload.error.code, 'TEST_ERROR');
  assert.equal(payload.error.message, 'Custom failure');

  const requestSnapshot = diagnostics.requests().find((entry) => entry.path.includes('/fail'));
  assert.ok(requestSnapshot);
  assert.equal(requestSnapshot?.errorCode, 'TEST_ERROR');
  const metadata = requestSnapshot?.metadata as Record<string, unknown> | undefined;
  assert.equal(metadata?.errorCode, 'TEST_ERROR');

  const err = createError('CONFIG_MISSING', 'Configuration missing', { status: 400 });
  assert.equal(isAppError(err), true);
  assert.equal(err.status, 400);
});
