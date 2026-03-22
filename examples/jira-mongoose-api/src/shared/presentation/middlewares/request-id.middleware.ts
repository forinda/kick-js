import { v4 as uuidv4 } from 'uuid';
import type { Request, Response, NextFunction } from 'express';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  res.setHeader('X-Request-Id', requestId);
  (req as any).requestId = requestId;
  next();
};
