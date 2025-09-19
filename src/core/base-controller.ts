import type { Response } from 'express';
import { createError, type AppErrorOptions } from '../utils/errors';
import { RequestTracker } from './request-tracker';
import type { RequestState } from '../shared/types';

export abstract class BaseController {
  protected constructor(private readonly requestTracker: RequestTracker) {}

  protected abstract controllerId(): string;

  protected ok<T>(res: Response, payload: T) {
    return this.respond(res, 200, payload);
  }

  protected created<T>(res: Response, payload: T) {
    return this.respond(res, 201, payload);
  }

  protected accepted<T>(res: Response, payload: T) {
    return this.respond(res, 202, payload);
  }

  protected noContent(res: Response) {
    return this.respond(res, 204);
  }

  protected respond<T>(res: Response, status: number, payload?: T) {
    this.requestTracker.recordResponse(res, status, payload);
    if (payload === undefined) {
      res.status(status).end();
    } else {
      res.status(status).json(payload);
    }
    return res;
  }

  protected logDebug(res: Response, message: string, metadata?: Record<string, unknown>) {
    this.requestTracker.log(res, `[${this.controllerId()}] ${message}`, 'debug', metadata);
  }

  protected logInfo(res: Response, message: string, metadata?: Record<string, unknown>) {
    this.requestTracker.log(res, `[${this.controllerId()}] ${message}`, 'info', metadata);
  }

  protected logWarn(res: Response, message: string, metadata?: Record<string, unknown>) {
    this.requestTracker.log(res, `[${this.controllerId()}] ${message}`, 'warn', metadata);
  }

  protected logError(res: Response, message: string, metadata?: Record<string, unknown>) {
    this.requestTracker.log(res, `[${this.controllerId()}] ${message}`, 'error', metadata);
  }

  protected mergeRequestMetadata(res: Response, patch: Record<string, unknown>) {
    const current = this.requestTracker.get(res)?.state.metadata[this.controllerId()];
    const currentRecord = typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {};

    const namespacedPatch: Record<string, unknown> = {
      [this.controllerId()]: {
        ...currentRecord,
        ...patch
      }
    };

    this.requestTracker.mergeMetadata(res, namespacedPatch);
  }

  protected getRequestState(res: Response): RequestState | undefined {
    return this.requestTracker.get(res)?.state;
  }

  protected fail(code: string, message: string, options?: AppErrorOptions): never {
    throw createError(code, message, options);
  }
}
