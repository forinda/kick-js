import { bootstrap, createApp } from './core/application';
import { configureApp } from './shared/config';
import type { BootstrapContext, BootstrapOptions, CreateAppOptions } from './core/application';

configureApp({ prefix: '/api' });

export { bootstrap, createApp };
export type { BootstrapContext, BootstrapOptions, CreateAppOptions };

if (require.main === module) {
  bootstrap().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}
