import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestIdMiddleware } from '@/shared/presentation/middlewares/request-id.middleware';
// import {}
export const middleware = [
  requestIdMiddleware,
  cors(),
  helmet(),
  express.json({ limit: '5mb' }),
  express.urlencoded({ extended: true }),
];
