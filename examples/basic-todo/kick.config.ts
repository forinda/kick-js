import type { KickConfig } from '../../src/cli/types';

const config: KickConfig = {
  app: {
    name: 'Basic Todo App',
    port: 3005,
    host: 'localhost',
    prefix: '/api/v1',
    env: 'development'
  },
  dev: {
    port: 3005,
    host: 'localhost',
    entry: 'src/index.ts',
    watch: true,
    env: {
      NODE_ENV: 'development',
      DEBUG: 'todo:*'
    }
  },
  start: {
    port: 3005,
    host: '0.0.0.0',
    entry: 'dist/index.js',
    env: {
      NODE_ENV: 'production'
    }
  }
};

export default config;