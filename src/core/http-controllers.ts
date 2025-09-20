import type { NextFunction, Request, Response } from 'express';
import { BaseController } from './base-controller';
import type { HttpMethod } from '../decorators/http';

const VERB_CONTROLLER_SYMBOL = Symbol.for('kick:core:verb-controller');

/**
 * Base class for controllers that target a specific HTTP verb. Each discovered controller
 * should extend one of the verb specific classes so that single responsibility is enforced.
 */
export abstract class HttpVerbController<
  Req extends Request = Request,
  Res extends Response = Response,
  Result = unknown
> extends BaseController {
  /**
   * Return the HTTP method associated with this controller. Static so discovery can consume it
   * without instantiating the controller (which would require container dependencies).
   */
  public static method(): HttpMethod {
    throw new Error('HttpVerbController.method() must be implemented by subclasses');
  }

  /** HTTP method instance mirror for convenience in handlers/tests. */
  public readonly httpMethod: HttpMethod = (this.constructor as typeof HttpVerbController).method();

  /**
   * Optional static override for the route path. When provided, discovery will use this value
   * instead of deriving the path from the file-system location.
   */
  public static route?: string;

  /**
   * Optional static tags collection. These map to the controller metadata and can be used by
   * diagnostics tooling.
   */
  public static tags?: string[];

  protected controllerId(): string {
    return this.constructor.name;
  }

  /**
   * Handle the request for the configured HTTP verb.
   */
  public abstract handle(req: Req, res: Res, next: NextFunction): Result | Promise<Result>;
}

Object.defineProperty(HttpVerbController, VERB_CONTROLLER_SYMBOL, {
  value: true,
  enumerable: false,
  configurable: false,
  writable: false
});

export abstract class GetController<Req extends Request = Request, Res extends Response = Response, Result = unknown>
  extends HttpVerbController<Req, Res, Result>
{
  public static method(): HttpMethod {
    return 'get';
  }
}

export abstract class PostController<Req extends Request = Request, Res extends Response = Response, Result = unknown>
  extends HttpVerbController<Req, Res, Result>
{
  public static method(): HttpMethod {
    return 'post';
  }
}

export abstract class PutController<Req extends Request = Request, Res extends Response = Response, Result = unknown>
  extends HttpVerbController<Req, Res, Result>
{
  public static method(): HttpMethod {
    return 'put';
  }
}

export abstract class PatchController<Req extends Request = Request, Res extends Response = Response, Result = unknown>
  extends HttpVerbController<Req, Res, Result>
{
  public static method(): HttpMethod {
    return 'patch';
  }
}

export abstract class DeleteController<Req extends Request = Request, Res extends Response = Response, Result = unknown>
  extends HttpVerbController<Req, Res, Result>
{
  public static method(): HttpMethod {
    return 'delete';
  }
}

export type VerbSpecificController =
  | (new (...args: never[]) => HttpVerbController)
  | (new (...args: never[]) => GetController)
  | (new (...args: never[]) => PostController)
  | (new (...args: never[]) => PutController)
  | (new (...args: never[]) => PatchController)
  | (new (...args: never[]) => DeleteController);

export function isVerbController(constructor: unknown): constructor is typeof HttpVerbController {
  if (typeof constructor !== 'function') {
    return false;
  }

  return Boolean((constructor as unknown as Record<symbol, unknown>)[VERB_CONTROLLER_SYMBOL]);
}
