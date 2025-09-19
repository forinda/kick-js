import type { LoggerConfig } from '../utils/logger';

export interface TelemetryConfig {
  trackReactiveHistory?: boolean;
  requestHistoryLimit?: number;
}

export interface AppConfig {
  prefix?: string;
  healthEndpoint?: string | false;
  logging?: LoggerConfig;
  telemetry?: TelemetryConfig;
}

export interface ResolvedAppConfig {
  prefix: string;
  healthEndpoint: string | false;
  logging: Required<LoggerConfig>;
  telemetry: Required<TelemetryConfig>;
}

const DEFAULT_CONFIG: ResolvedAppConfig = {
  prefix: '',
  healthEndpoint: '/health',
  logging: {
    level: 'info'
  },
  telemetry: {
    trackReactiveHistory: true,
    requestHistoryLimit: 250
  }
};

let currentConfig: ResolvedAppConfig = { ...DEFAULT_CONFIG };

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
  currentConfig = { ...DEFAULT_CONFIG };
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
    }
  };
}
