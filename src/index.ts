// Export core framework
export * from './core';

// Export config helpers for app configuration
export {
  createKickConfig,
  defineAppConfig,
  defineDevConfig,
  defineStartConfig
} from './cli/utils/config-helpers';

export {
  loadAppConfig,
  getConfigFromEnv
} from './core/utils/app-config';

export type {
  KickConfig,
  KickAppConfig,
  KickDevConfig,
  KickStartConfig
} from './cli/types';