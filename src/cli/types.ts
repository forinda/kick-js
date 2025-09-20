export type CommandStep = string;

export interface KickCommandDefinition {
  name: string;
  description?: string;
  steps?: CommandStep | CommandStep[];
}

export interface KickGeneratorsConfig {
  controllerRoot?: string;
}

export interface KickCliConfig {
  commands?: KickCommandDefinition[];
  generators?: KickGeneratorsConfig;
  structure?: KickStructureConfig;
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
