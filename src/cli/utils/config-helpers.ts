import { KickConfig, KickAppConfig, KickDevConfig, KickStartConfig } from '../types';

/**
 * Create a KickJS configuration with TypeScript intellisense support
 */
export function createKickConfig(config: KickConfig): KickConfig {
  return config;
}

/**
 * Helper function to create app-specific configuration
 */
export function defineAppConfig(config: KickAppConfig): KickAppConfig {
  return config;
}

/**
 * Helper function to create development configuration
 */
export function defineDevConfig(config: KickDevConfig): KickDevConfig {
  return config;
}

/**
 * Helper function to create production configuration  
 */
export function defineStartConfig(config: KickStartConfig): KickStartConfig {
  return config;
}

// Re-export types for convenience
export type {
  KickConfig,
  KickAppConfig,
  KickDevConfig,
  KickStartConfig
} from '../types';