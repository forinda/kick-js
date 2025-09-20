export {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  listRegisteredControllers,
  registerController,
  resetControllerRegistry
} from './decorators/http';
export type { RouteOptions, RouteValidation, ControllerConstructor } from './decorators/http';

export { BaseController } from './core/base-controller';
export {
  HttpVerbController,
  GetController,
  PostController,
  PutController,
  PatchController,
  DeleteController
} from './core/http-controllers';
export { discoverControllersFromFilesystem } from './core/controller-discovery';
export type { DiscoveredController } from './core/controller-discovery';
export { RequestTracker } from './core/request-tracker';
export { AppDiagnostics } from './core/diagnostics';
export { createApp, bootstrap } from './core/application';
export type { CreateAppOptions, CreateAppResult, BootstrapOptions, BootstrapContext } from './core/application';

export {
  configureApp,
  getAppConfig,
  resolveConfig,
  resetAppConfig,
  createKickConfig
} from './shared/config';
export type {
  AppConfig,
  ResolvedAppConfig,
  ApiConfig,
  ResolvedApiConfig,
  ControllerDiscoveryConfig,
  ResolvedControllerDiscoveryConfig,
  CreateKickConfigOptions,
  EnvBinding,
  EnvBindingOptions,
  AppConfigPath
} from './shared/config';
export type { KickCliConfig, KickCommandDefinition, KickStructureConfig, KickConfig } from './cli/types';

export { TYPES } from './shared/types';
export type { AppState, RequestState, RequestLogEntry } from './shared/types';

export { createError, AppError, isAppError } from './utils/errors';
export type { AppErrorOptions } from './utils/errors';

export {
  Inject,
  Injectable,
  MultiInject,
  Named,
  Optional,
  Tagged,
  Unmanaged
} from './utils/injection';
export type { BindingIdentifier } from './utils/injection';
