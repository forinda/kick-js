import { beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import httpMocks from 'node-mocks-http';
import type { Request, Response } from 'express';

import {
  BaseController,
  Controller,
  Get,
  createApp,
  createError,
  isAppError,
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

describe('errors', () => {
  beforeEach(() => {
    resetControllerRegistry();
    resetAppConfig();
    configureApp({ logging: { level: 'error' } });
  });

  it('AppError helpers propagate structured codes through the pipeline', async () => {
    @Controller('/fail')
    class FailController extends BaseController {
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
    const res = await dispatch(app, { method: 'GET', url: '/fail/' });

    expect(res.statusCode).toBe(418);
    const payload = res._getJSONData();
    expect(payload.error.code).toBe('TEST_ERROR');
    expect(payload.error.message).toBe('Custom failure');

    const requestSnapshot = diagnostics.requests().find((entry) => entry.path.includes('/fail'));
    expect(requestSnapshot).toBeDefined();
    expect(requestSnapshot?.errorCode).toBe('TEST_ERROR');
    const metadata = requestSnapshot?.metadata as Record<string, unknown> | undefined;
    expect(metadata?.errorCode).toBe('TEST_ERROR');

    const err = createError('CONFIG_MISSING', 'Configuration missing', { status: 400 });
    expect(isAppError(err)).toBe(true);
    expect(err.status).toBe(400);
  });
});
