import { existsSync } from 'node:fs';
import path from 'node:path';
import { KickConfig, KickAppConfig, KickDevConfig, KickStartConfig, KickCommandDefinition } from '../types';

const CONFIG_FILE_NAMES = [
  'kick.config.ts',
  'kick.config.js',
  'kick.config.mjs',
  'kickjs.config.ts',
  'kickjs.config.js',
  'kickjs.config.mjs'
];

export interface LoadedKickConfig extends KickConfig {
  configPath?: string;
  commands?: KickCommandDefinition[];
}

/**
 * Load KickJS configuration from the current working directory
 */
export async function loadKickConfig(cwd?: string): Promise<LoadedKickConfig> {
  const workingDir = cwd || process.cwd();
  
  // Try to find config file
  for (const configFileName of CONFIG_FILE_NAMES) {
    const configPath = path.resolve(workingDir, configFileName);
    
    if (existsSync(configPath)) {
      try {
        // Dynamic import to handle both .ts and .js files
        const configModule = await import(configPath);
        const config = configModule.default || configModule;
        
        return {
          ...config,
          configPath
        };
      } catch (error) {
        console.warn(`⚠️  Failed to load config from ${configPath}:`, error);
      }
    }
  }
  
  // Return default config if no file found
  return getDefaultConfig();
}

/**
 * Get default configuration
 */
export function getDefaultConfig(): KickConfig {
  return {
    app: {
      name: 'KickJS App',
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
        NODE_ENV: 'development'
      }
    },
    start: {
      port: 3000,
      host: '0.0.0.0',
      entry: 'dist/index.js',
      env: {
        NODE_ENV: 'production'
      }
    },
    structure: {
      domainRoot: 'src/domains',
      domainFolders: ['controllers', 'services', 'domain'],
      defaultDomain: 'app'
    },
    generators: {
      controllerRoot: 'src/domains/app/controllers'
    },
    commands: []
  };
}

/**
 * Merge config with CLI options
 */
export function mergeConfigWithOptions(
  config: KickConfig,
  cliOptions: Record<string, any>,
  command: 'dev' | 'start'
): KickDevConfig | KickStartConfig {
  const defaultConfig = getDefaultConfig();
  const baseConfig = command === 'dev' 
    ? (config.dev || defaultConfig.dev)
    : (config.start || defaultConfig.start);
  
  return {
    ...baseConfig,
    port: cliOptions.port ? parseInt(cliOptions.port) : baseConfig?.port,
    host: cliOptions.host || baseConfig?.host,
    entry: cliOptions.entry || baseConfig?.entry,
    env: {
      ...baseConfig?.env,
      ...cliOptions.env
    }
  };
}

/**
 * Get app config merged with overrides
 */
export function getAppConfig(
  config: KickConfig,
  overrides: Partial<KickAppConfig> = {}
): KickAppConfig {
  return {
    ...getDefaultConfig().app,
    ...config.app,
    ...overrides
  };
}