export default {
  app: {
    name: 'KickJS Framework',
    port: 3000,
    host: 'localhost',
    prefix: '',
    env: 'development'
  },
  dev: {
    port: 3000,
    host: 'localhost',
    entry: 'src/index.ts',
    watch: true,
    env: {
      NODE_ENV: 'development',
      DEBUG: 'kick:*'
    }
  },
  start: {
    port: 3000,
    host: '0.0.0.0',
    entry: 'dist/index.js',
    env: {
      NODE_ENV: 'production'
    }
  }
};
