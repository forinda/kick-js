import 'reflect-metadata';
import { bootstrap } from '@forinda/kickjs-http';
import { modules } from './modules';
import { adapters } from './config/adapters';
import { middleware } from './config/middleware';

bootstrap({
  modules,
  apiPrefix: '/api',
  defaultVersion: 1,
  middleware,
  
  adapters,
});
