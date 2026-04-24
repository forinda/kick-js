import 'reflect-metadata';
import { bootstrap } from '@forinda/kickjs';
import { modules } from './modules';
import { adapters } from './config/adapters';
import { middleware } from './config/middleware';
import { plugins } from './config/plugins';

export const app = await bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,
  middleware,

  adapters,
  plugins,
});
