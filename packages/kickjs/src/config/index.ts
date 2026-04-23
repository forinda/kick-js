/**
 * Environment validation and typed config — formerly published as
 * `@forinda/kickjs-config` (removed in v4). Now lives inside
 * `@forinda/kickjs` so apps pick it up with no extra install.
 */

export {
  baseEnvSchema,
  defineEnv,
  loadEnv,
  getEnv,
  reloadEnv,
  resetEnvCache,
  type Env,
} from './env'
export { ConfigService, createConfigService, type TypedConfigService } from './config-service'
