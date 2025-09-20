import type { Request, Response } from 'express';
import { GetController } from '../../../../src';

export default class AdminReportGetController extends GetController {
  handle(req: Request, res: Response) {
    this.logInfo(res, 'Fetching report', { id: req.params.id });
    return this.ok(res, { reportId: req.params.id });
  }
}
