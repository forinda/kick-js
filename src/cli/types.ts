export type CommandStep = string;

export interface KickCommandDefinition {
  name: string;
  description?: string;
  steps?: CommandStep | CommandStep[];
}

export interface KickGeneratorsConfig {
  controllerRoot?: string;
}

export interface KickAppConfig {
  name?: string;
  port?: number;
  host?: string;
  prefix?: string;
  env?: 'development' | 'production' | string;
}

export interface KickDevConfig {
  port?: number;
  host?: string;
  entry?: string;
  watch?: boolean;
  env?: Record<string, string>;
}

export interface KickStartConfig {
  port?: number;
  host?: string;
  entry?: string;
  env?: Record<string, string>;
}

export interface KickCliConfig {
  commands?: KickCommandDefinition[];
  generators?: KickGeneratorsConfig;
  structure?: KickStructureConfig;
  app?: KickAppConfig;
  dev?: KickDevConfig;
  start?: KickStartConfig;
}

export interface CustomCommandRuntime {
  cwd: string;
}

export interface KickStructureConfig {
  domainRoot?: string;
  domainFolders?: string[];
  defaultDomain?: string;
}

export type KickConfig = KickCliConfig;
