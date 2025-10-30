import { KickAppConfig } from '../../cli/types';
import { loadKickConfig, getAppConfig } from '../../cli/utils/config-loader';

/**
 * Load KickJS app configuration for use in applications
 */
export async function loadAppConfig(overrides: Partial<KickAppConfig> = {}): Promise<KickAppConfig> {
  const kickConfig = await loadKickConfig();
  return getAppConfig(kickConfig, overrides);
}

/**
 * Get app configuration from environment variables and config
 */
export function getConfigFromEnv(): Partial<KickAppConfig> {
  return {
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
    host: process.env.HOST || undefined,
    env: process.env.NODE_ENV || undefined
  };
}