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
  configureApp,
  resetControllerRegistry,
  resetAppConfig
} from '../src';

test.beforeEach(() => {
  resetControllerRegistry();
  resetAppConfig();
  configureApp({ logging: { level: 'error' } });
});

test('controllers auto-register and respect configured prefix', async () => {
  configureApp({ prefix: '/v1' });

  @Controller('/hello')
  class HelloController extends BaseController {
    constructor(@Inject(TYPES.RequestTracker) tracker: RequestTracker) {
      super(tracker);
    }

    protected controllerId(): string {
      return 'HelloController';
    }

    @Get('/')
    handle(_req: Request, res: Response) {
      this.mergeRequestMetadata(res, { greeted: true });
      this.logInfo(res, 'Hello issued');
      return this.ok(res, { message: 'hello' });
    }
  }

  const { app, diagnostics } = createApp();
  const expressApp = app as unknown as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void };

  const req = httpMocks.createRequest<Request>({
    method: 'GET',
    url: '/v1/hello/'
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

  assert.equal(res.statusCode, 200);
  const payload = res._getJSONData();
  assert.equal(payload.message, 'hello');

  const requestSnapshots = diagnostics.requests();
  assert.equal(requestSnapshots.length >= 1, true);
  const first = requestSnapshots.find((entry) => entry.path.includes('/v1/hello'));
  assert.ok(first, 'expected request snapshot to exist');
  const helloMetadata = (first?.metadata?.HelloController as Record<string, unknown> | undefined) ?? {};
  assert.equal(helloMetadata.greeted, true);
});
