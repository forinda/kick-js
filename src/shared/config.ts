import type { LoggerConfig } from '../utils/logger';
import { loadEnvFiles } from '../utils/env';

export interface TelemetryConfig {
  trackReactiveHistory?: boolean;
  requestHistoryLimit?: number;
}

export interface ControllerDiscoveryConfig {
  enabled?: boolean;
  roots?: string[];
  suffix?: string;
  extensions?: string[];
  baseRoute?: string;
  segmentSeparator?: string;
  enforceStructure?: boolean;
  registerGlobally?: boolean;
  ignore?: string[];
  tagsFromDirectories?: boolean;
  allowStaticRoutes?: boolean;
}

export interface ApiConfig {
  discovery?: ControllerDiscoveryConfig;
}

export interface AppConfig {
  prefix?: string;
  healthEndpoint?: string | false;
  logging?: LoggerConfig;
  telemetry?: TelemetryConfig;
  api?: ApiConfig;
}

export type AppConfigPath =
  | 'prefix'
  | 'healthEndpoint'
  | 'logging.level'
  | 'telemetry.trackReactiveHistory'
  | 'telemetry.requestHistoryLimit'
  | 'api.discovery.enabled'
  | 'api.discovery.roots'
  | 'api.discovery.baseRoute';

export interface ResolvedControllerDiscoveryConfig {
  enabled: boolean;
  roots: string[];
  suffix: string;
  extensions: string[];
  baseRoute: string;
  segmentSeparator: string;
  enforceStructure: boolean;
  registerGlobally: boolean;
  ignore: string[];
  tagsFromDirectories: boolean;
  allowStaticRoutes: boolean;
}

export interface ResolvedApiConfig {
  discovery: ResolvedControllerDiscoveryConfig;
}

export interface ResolvedAppConfig {
  prefix: string;
  healthEndpoint: string | false;
  logging: Required<LoggerConfig>;
  telemetry: Required<TelemetryConfig>;
  api: ResolvedApiConfig;
}

const DEFAULT_DISCOVERY_CONFIG: ResolvedControllerDiscoveryConfig = {
  enabled: true,
  roots: ['src/domains', 'src/http'],
  suffix: '.controller',
  extensions: ['.ts', '.js', '.mjs', '.cjs'],
  baseRoute: '/',
  segmentSeparator: '.',
  enforceStructure: true,
  registerGlobally: true,
  ignore: ['__tests__', '__mocks__', '.DS_Store'],
  tagsFromDirectories: true,
  allowStaticRoutes: true
};

const DEFAULT_CONFIG: ResolvedAppConfig = {
  prefix: '',
  healthEndpoint: '/health',
  logging: {
    level: 'info'
  },
  telemetry: {
    trackReactiveHistory: true,
    requestHistoryLimit: 250
  },
  api: {
    discovery: DEFAULT_DISCOVERY_CONFIG
  }
};

let currentConfig: ResolvedAppConfig = cloneResolvedConfig(DEFAULT_CONFIG);

export interface EnvBindingOptions<T = unknown> {
  path: AppConfigPath;
  transform?: (value: string, env: NodeJS.ProcessEnv) => T;
}

export type EnvBinding = AppConfigPath | EnvBindingOptions | ((value: string, env: NodeJS.ProcessEnv) => AppConfig);

export interface CreateKickConfigOptions {
  defaults?: AppConfig;
  env?: Record<string, EnvBinding>;
  overrides?: AppConfig | ((config: AppConfig) => AppConfig);
  envFiles?: string[] | false;
}

export function createKickConfig(options: CreateKickConfigOptions = {}): AppConfig {
  if (options.envFiles !== false) {
    const defaultFiles = ['.env'];
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv) {
      defaultFiles.push(`.env.${nodeEnv}`);
    }
    defaultFiles.push('.env.local');
    const envFiles = Array.isArray(options.envFiles) ? options.envFiles : defaultFiles;
    loadEnvFiles(envFiles);
  }

  let config: AppConfig = { ...(options.defaults ?? {}) };

  if (options.env) {
    for (const [envKey, binding] of Object.entries(options.env)) {
      const rawValue = process.env[envKey];
      if (rawValue === undefined) {
        continue;
      }

      if (typeof binding === 'function') {
        const partial = binding(rawValue, process.env);
        config = mergeAppConfigs(config, partial);
        continue;
      }

      if (typeof binding === 'string') {
        config = setConfigValue(config, binding, autoCast(rawValue));
        continue;
      }

      const value = binding.transform ? binding.transform(rawValue, process.env) : autoCast(rawValue);
      config = setConfigValue(config, binding.path, value);
    }
  }

  if (options.overrides) {
    const overrides = typeof options.overrides === 'function' ? options.overrides(config) : options.overrides;
    config = mergeAppConfigs(config, overrides);
  }

  return config;
}

export function configureApp(config: AppConfig) {
  currentConfig = mergeConfig(currentConfig, config);
}

export function getAppConfig(): ResolvedAppConfig {
  return currentConfig;
}

export function resolveConfig(overrides?: AppConfig): ResolvedAppConfig {
  if (!overrides) {
    return currentConfig;
  }

  return mergeConfig(currentConfig, overrides);
}

export function resetAppConfig() {
  currentConfig = cloneResolvedConfig(DEFAULT_CONFIG);
}

function mergeConfig(base: ResolvedAppConfig, overrides: AppConfig): ResolvedAppConfig {
  return {
    prefix: overrides.prefix ?? base.prefix,
    healthEndpoint: overrides.healthEndpoint ?? base.healthEndpoint,
    logging: {
      level: overrides.logging?.level ?? base.logging.level
    },
    telemetry: {
      trackReactiveHistory: overrides.telemetry?.trackReactiveHistory ?? base.telemetry.trackReactiveHistory,
      requestHistoryLimit: overrides.telemetry?.requestHistoryLimit ?? base.telemetry.requestHistoryLimit
    },
    api: {
      discovery: mergeDiscoveryConfig(base.api.discovery, overrides.api?.discovery)
    }
  };
}

function cloneResolvedConfig(config: ResolvedAppConfig): ResolvedAppConfig {
  return {
    prefix: config.prefix,
    healthEndpoint: config.healthEndpoint,
    logging: { ...config.logging },
    telemetry: { ...config.telemetry },
    api: {
      discovery: {
        enabled: config.api.discovery.enabled,
        roots: [...config.api.discovery.roots],
        suffix: config.api.discovery.suffix,
        extensions: [...config.api.discovery.extensions],
        baseRoute: config.api.discovery.baseRoute,
        segmentSeparator: config.api.discovery.segmentSeparator,
        enforceStructure: config.api.discovery.enforceStructure,
        registerGlobally: config.api.discovery.registerGlobally,
        ignore: [...config.api.discovery.ignore],
        tagsFromDirectories: config.api.discovery.tagsFromDirectories,
        allowStaticRoutes: config.api.discovery.allowStaticRoutes
      }
    }
  };
}

function mergeDiscoveryConfig(
  base: ResolvedControllerDiscoveryConfig,
  overrides?: ControllerDiscoveryConfig
): ResolvedControllerDiscoveryConfig {
  if (!overrides) {
    return { ...base, roots: [...base.roots], extensions: [...base.extensions], ignore: [...base.ignore] };
  }

  return {
    enabled: overrides.enabled ?? base.enabled,
    roots: overrides.roots ? [...overrides.roots] : [...base.roots],
    suffix: overrides.suffix ?? base.suffix,
    extensions: overrides.extensions ? [...overrides.extensions] : [...base.extensions],
    baseRoute: overrides.baseRoute ?? base.baseRoute,
    segmentSeparator: overrides.segmentSeparator ?? base.segmentSeparator,
    enforceStructure: overrides.enforceStructure ?? base.enforceStructure,
    registerGlobally: overrides.registerGlobally ?? base.registerGlobally,
    ignore: overrides.ignore ? [...overrides.ignore] : [...base.ignore],
    tagsFromDirectories: overrides.tagsFromDirectories ?? base.tagsFromDirectories,
    allowStaticRoutes: overrides.allowStaticRoutes ?? base.allowStaticRoutes
  };
}

function mergeAppConfigs(base: AppConfig, patch?: AppConfig): AppConfig {
  if (!patch) {
    return base;
  }

  const merged: AppConfig = { ...base };

  if (patch.prefix !== undefined) {
    merged.prefix = patch.prefix;
  }
  if (patch.healthEndpoint !== undefined) {
    merged.healthEndpoint = patch.healthEndpoint;
  }
  if (patch.logging) {
    merged.logging = { ...merged.logging, ...patch.logging };
  }
  if (patch.telemetry) {
    merged.telemetry = { ...merged.telemetry, ...patch.telemetry };
  }
  if (patch.api?.discovery) {
    merged.api = merged.api ?? {};
    merged.api.discovery = {
      ...merged.api.discovery,
      ...patch.api.discovery
    } as ControllerDiscoveryConfig;
  }

  return merged;
}

function setConfigValue(config: AppConfig, path: AppConfigPath, value: unknown): AppConfig {
  const patch = buildConfigFromPath(path, value);
  return mergeAppConfigs(config, patch);
}

function buildConfigFromPath(path: string, value: unknown): AppConfig {
  const segments = path.split('.');
  const result: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = result;

  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }

    cursor[segment] = cursor[segment] ? { ...(cursor[segment] as Record<string, unknown>) } : {};
    cursor = cursor[segment] as Record<string, unknown>;
  });

  return result as AppConfig;
}

function autoCast(value: string) {
  const lower = value.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }

  const num = Number(value);
  if (!Number.isNaN(num) && `${num}` === value.trim()) {
    return num;
  }

  try {
    if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
      return JSON.parse(value);
    }
  } catch (error) {
    // fallthrough to string
  }

  return value;
}
