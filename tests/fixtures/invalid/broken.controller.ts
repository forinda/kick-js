import { BaseController } from '../../../src';
import type { Request, Response, NextFunction } from 'express';

export class BrokenController extends BaseController {
  protected controllerId(): string {
    return 'BrokenController';
  }

  handle(_req: Request, res: Response, _next: NextFunction) {
    return this.ok(res, { broken: true });
  }
}
