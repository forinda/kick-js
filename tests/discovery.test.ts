import { beforeEach, describe, expect, it } from 'vitest';
import 'reflect-metadata';
import path from 'node:path';
import httpMocks from 'node-mocks-http';
import type { Request, Response } from 'express';

import { configureApp, createApp, resetAppConfig, resetControllerRegistry } from '../src';

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

describe('controller discovery', () => {
  const fixturesRoot = path.join(__dirname, 'fixtures/http');
  const invalidRoot = path.join(__dirname, 'fixtures/invalid');

  beforeEach(() => {
    resetControllerRegistry();
    resetAppConfig();
    configureApp({ logging: { level: 'error' } });
  });

  it('auto-discovers controllers and wires routes based on filesystem structure', async () => {
    configureApp({
      api: {
        discovery: {
          roots: [fixturesRoot]
        }
      }
    });

    const { app, discovery } = createApp();

    expect(discovery.controllers.length).toBeGreaterThanOrEqual(2);

    const byRoute = new Map(discovery.controllers.map((entry) => [entry.route, entry]));
    expect(byRoute.get('/users')).toBeDefined();
    expect(byRoute.get('/admin/reports/:id')).toBeDefined();
    expect(byRoute.get('/admin/reports/:id')?.tags).toContain('admin');

    const usersRes = await dispatch(app, { method: 'GET', url: '/users' });
    expect(usersRes.statusCode).toBe(200);
    expect(usersRes._getJSONData()).toStrictEqual({ users: ['Ada', 'Linus'] });

    const reportRes = await dispatch(app, { method: 'GET', url: '/admin/reports/42' });
    expect(reportRes.statusCode).toBe(200);
    expect(reportRes._getJSONData()).toStrictEqual({ reportId: '42' });
  });

  it('enforces naming structure when configured to do so', () => {
    configureApp({
      api: {
        discovery: {
          roots: [invalidRoot]
        }
      }
    });

    expect(() => createApp()).toThrowError(/must follow <name>\.<verb>/i);
  });
});
