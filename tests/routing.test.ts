import { beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import httpMocks from 'node-mocks-http';
import type { Request, Response } from 'express';

import {
  BaseController,
  Controller,
  Get,
  createApp,
  configureApp,
  resetControllerRegistry,
  resetAppConfig
} from '../src';

function toExpressApp(app: unknown) {
  return app as { handle: (req: Request, res: Response, next: (err?: unknown) => void) => void };
}

async function dispatch(app: unknown, options: Parameters<typeof httpMocks.createRequest>[0]) {
  const expressApp = toExpressApp(app);
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

describe('routing', () => {
  beforeEach(() => {
    resetControllerRegistry();
    resetAppConfig();
    configureApp({ logging: { level: 'error' } });
  });

  it('controllers auto-register and respect configured prefix', async () => {
    configureApp({ prefix: '/v1' });

    @Controller('/hello')
    class HelloController extends BaseController {
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
    const res = await dispatch(app, { method: 'GET', url: '/v1/hello/' });

    expect(res.statusCode).toBe(200);
    const payload = res._getJSONData();
    expect(payload.message).toBe('hello');

    const requestSnapshots = diagnostics.requests();
    expect(requestSnapshots.length).toBeGreaterThanOrEqual(1);
    const first = requestSnapshots.find((entry) => entry.path.includes('/v1/hello'));
    expect(first).toBeDefined();
    const helloMetadata = (first?.metadata?.HelloController as Record<string, unknown> | undefined) ?? {};
    expect(helloMetadata.greeted).toBe(true);
  });
});
