import 'reflect-metadata';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import type { Server } from 'http';
import type { Container } from 'inversify';
import { AppDiagnostics } from './diagnostics';
import { RequestTracker } from './request-tracker';
import { registerControllers } from './server';
import { buildContainer } from '../infrastructure/container';
import { resolveConfig, type AppConfig, type ResolvedAppConfig } from '../shared/config';
import { TYPES } from '../shared/types';
import { createError, isAppError } from '../utils/errors';
import { discoverControllersFromFilesystem, type DiscoveredController } from './controller-discovery';

export interface CreateAppOptions {
  controllers?: Array<new (...args: never[]) => unknown>;
  container?: Container;
  additionalMiddleware?: Array<(req: Request, res: Response, next: NextFunction) => void>;
  config?: AppConfig;
  configureContainer?: (container: Container) => void;
}

export interface CreateAppResult {
  app: Application;
  container: Container;
  requestTracker: RequestTracker;
  diagnostics: AppDiagnostics;
  config: ResolvedAppConfig;
  discovery: {
    controllers: DiscoveredController[];
  };
}

export interface BootstrapOptions extends CreateAppOptions {
  port?: number | string;
}

export interface BootstrapContext {
  app: Application;
  server: Server;
  container: Container;
  requestTracker: RequestTracker;
  diagnostics: AppDiagnostics;
  config: ResolvedAppConfig;
  discovery: {
    controllers: DiscoveredController[];
  };
  shutdown(): void;
}

export function createApp(options: CreateAppOptions = {}): CreateAppResult {
  const config = resolveConfig(options.config);
  const container = options.container ?? buildContainer(config);

  options.configureContainer?.(container);

  const app = express();
  const requestTracker = container.get<RequestTracker>(TYPES.RequestTracker);
  const diagnostics = container.get<AppDiagnostics>(TYPES.Diagnostics);

  const discoveredControllers = discoverControllersFromFilesystem(config.api.discovery);
  const manualControllers = options.controllers ?? [];
  const controllers = new Set<new (...args: never[]) => unknown>();
  manualControllers.forEach((ControllerClass) => controllers.add(ControllerClass));
  discoveredControllers.forEach((entry) => controllers.add(entry.controller));

  const controllersToRegister = controllers.size > 0 ? Array.from(controllers) : undefined;

  app.use(express.json());

  options.additionalMiddleware?.forEach((middleware) => {
    app.use(middleware);
  });

  app.use(requestTracker.middleware());

  registerControllers(app, container, {
    controllers: controllersToRegister,
    prefix: config.prefix
  });

  if (config.healthEndpoint !== false) {
    app.get(config.healthEndpoint, (_req, res) => {
      res.json({ status: 'ok' });
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = isAppError(err)
      ? err
      : createError('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unexpected error', {
          cause: err,
          status: 500
        });

    if (err instanceof Error && err.stack) {
      requestTracker.mergeMetadata(res, { errorStack: err.stack });
    }

    requestTracker.recordError(res, appError);

    const status = Number.isFinite(appError.status) ? Number(appError.status) : 500;
    const payload: Record<string, unknown> = {
      error: {
        code: appError.code,
        message: appError.message
      }
    };

    if (appError.details) {
      (payload.error as Record<string, unknown>).details = appError.details;
    }

    requestTracker.recordResponse(res, status, payload);

    if (!res.headersSent) {
      res.status(status).json(payload);
    }
  });

  return {
    app,
    container,
    requestTracker,
    diagnostics,
    config,
    discovery: {
      controllers: discoveredControllers
    }
  };
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapContext> {
  const { app, container, requestTracker, diagnostics, config, discovery } = createApp(options);
  const port = Number(options.port ?? process.env.PORT ?? 3000);

  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`🚀 Server listening on http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('HTTP server closed');
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { app, server, container, requestTracker, diagnostics, config, discovery, shutdown };
}
