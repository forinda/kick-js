import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Inject, Injectable } from '../utils/injection';
import { createReactive, type Reactive, type ReactiveRegistry } from '../utils/reactive';
import { TYPES, type RequestLogEntry, type RequestState } from '../shared/types';
import type { ResolvedAppConfig } from '../shared/config';
import type { AppLogger } from '../utils/logger';
import { isAppError } from '../utils/errors';

declare module 'express-serve-static-core' {
  interface Locals {
    requestState?: Reactive<RequestState>;
  }
}

@Injectable()
export class RequestTracker {
  constructor(
    @Inject(TYPES.StateRegistry) private readonly registry: ReactiveRegistry,
    @Inject(TYPES.Config) private readonly config: ResolvedAppConfig,
    @Inject(TYPES.Logger) private readonly logger: AppLogger
  ) {}

  middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const id = randomUUID();
      const requestState = createReactive<RequestState>(
        {
          id,
          method: req.method,
          path: req.originalUrl ?? req.url,
          startedAt: Date.now(),
          logs: [],
          metadata: {}
        },
        {
          id,
          label: `request:${req.method} ${req.originalUrl ?? req.url}`,
          registry: this.registry,
          trackHistory: this.config.telemetry.trackReactiveHistory,
          maxHistory: this.config.telemetry.requestHistoryLimit
        }
      );

      res.locals.requestState = requestState;

      req.on('error', (error: Error) => {
        this.recordError(res, error);
      });

      res.on('finish', () => {
        this.finalise(res);
      });

      res.on('close', () => {
        this.finalise(res);
      });

      res.on('error', (error: Error) => {
        this.recordError(res, error);
      });

      next();
    };
  }

  get(res: Response): Reactive<RequestState> | undefined {
    return res.locals.requestState;
  }

  log(res: Response, message: string, level: RequestLogEntry['level'] = 'info', metadata?: Record<string, unknown>) {
    const store = this.get(res);
    if (!store) {
      return;
    }

    const entry: RequestLogEntry = {
      timestamp: Date.now(),
      level,
      message,
      metadata
    };

    store.state.logs = [...store.state.logs, entry];

    this.dispatchLog(level, `[${store.state.method} ${store.state.path}] ${message}`, {
      requestId: store.state.id,
      ...metadata
    });
  }

  mergeMetadata(res: Response, patch: Record<string, unknown>) {
    const store = this.get(res);
    if (!store) {
      return;
    }

    store.state.metadata = {
      ...store.state.metadata,
      ...patch
    };
  }

  recordResponse(res: Response, status: number, payload?: unknown) {
    const store = this.get(res);
    if (!store) {
      return;
    }

    store.state.status = status;
    store.state.response = payload;
  }

  recordError(res: Response, error: unknown) {
    const store = this.get(res);
    if (!store) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    store.state.error = errorMessage;
    if (isAppError(error)) {
      store.state.errorCode = error.code;
      this.mergeMetadata(res, { errorCode: error.code, errorDetails: error.details });
    }

    this.log(res, errorMessage, 'error', {
      errorCode: isAppError(error) ? error.code : undefined
    });
  }

  private finalise(res: Response) {
    const store = this.get(res);
    if (!store) {
      return;
    }

    store.state.status = res.statusCode;
    store.state.endedAt = Date.now();
    store.state.durationMs = store.state.endedAt - store.state.startedAt;

    this.dispatchLog('debug', `Request completed with ${res.statusCode}`, {
      requestId: store.state.id,
      durationMs: store.state.durationMs
    });
  }

  private dispatchLog(level: RequestLogEntry['level'], message: string, metadata?: Record<string, unknown>) {
    switch (level) {
      case 'debug':
        this.logger.debug(message, metadata);
        break;
      case 'info':
        this.logger.info(message, metadata);
        break;
      case 'warn':
        this.logger.warn(message, metadata);
        break;
      case 'error':
        this.logger.error(message, metadata);
        break;
    }
  }
}
