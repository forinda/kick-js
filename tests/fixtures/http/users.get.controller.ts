import type { Request, Response } from 'express';
import { GetController } from '../../../src';

export default class UsersGetController extends GetController {
  handle(_req: Request, res: Response) {
    this.logInfo(res, 'Listing users');
    return this.ok(res, { users: ['Ada', 'Linus'] });
  }
}
