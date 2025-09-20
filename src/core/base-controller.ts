import type { Response } from 'express';
import { createError, type AppErrorOptions } from '../utils/errors';
import { RequestTracker } from './request-tracker';
import type { RequestState } from '../shared/types';
import { Inject, Injectable } from '../utils/injection';
import { TYPES } from '../shared/types';

@Injectable()
export abstract class BaseController {
  @Inject(TYPES.RequestTracker)
  // Using property injection so subclasses don't have to pass the tracker via super()
  private injectedTracker?: RequestTracker;

  private runtimeTracker?: RequestTracker;

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
    const tracker = this.ensureTracker();
    tracker.recordResponse(res, status, payload);
    if (payload === undefined) {
      res.status(status).end();
    } else {
      res.status(status).json(payload);
    }
    return res;
  }

  protected logDebug(res: Response, message: string, metadata?: Record<string, unknown>) {
    const tracker = this.ensureTracker();
    tracker.log(res, `[${this.controllerId()}] ${message}`, 'debug', metadata);
  }

  protected logInfo(res: Response, message: string, metadata?: Record<string, unknown>) {
    const tracker = this.ensureTracker();
    tracker.log(res, `[${this.controllerId()}] ${message}`, 'info', metadata);
  }

  protected logWarn(res: Response, message: string, metadata?: Record<string, unknown>) {
    const tracker = this.ensureTracker();
    tracker.log(res, `[${this.controllerId()}] ${message}`, 'warn', metadata);
  }

  protected logError(res: Response, message: string, metadata?: Record<string, unknown>) {
    const tracker = this.ensureTracker();
    tracker.log(res, `[${this.controllerId()}] ${message}`, 'error', metadata);
  }

  protected mergeRequestMetadata(res: Response, patch: Record<string, unknown>) {
    const tracker = this.ensureTracker();
    const current = tracker.get(res)?.state.metadata[this.controllerId()];
    const currentRecord = typeof current === 'object' && current !== null ? (current as Record<string, unknown>) : {};

    const namespacedPatch: Record<string, unknown> = {
      [this.controllerId()]: {
        ...currentRecord,
        ...patch
      }
    };

    tracker.mergeMetadata(res, namespacedPatch);
  }

  protected getRequestState(res: Response): RequestState | undefined {
    return this.ensureTracker().get(res)?.state;
  }

  protected fail(code: string, message: string, options?: AppErrorOptions): never {
    throw createError(code, message, options);
  }

  public attachRequestTracker(tracker: RequestTracker) {
    this.runtimeTracker = tracker;
  }

  private ensureTracker(): RequestTracker {
    if (this.runtimeTracker) {
      return this.runtimeTracker;
    }

    if (this.injectedTracker) {
      this.runtimeTracker = this.injectedTracker;
      return this.runtimeTracker;
    }

    throw createError('TRACKER_MISSING', 'RequestTracker is not available on this controller');
  }
}
