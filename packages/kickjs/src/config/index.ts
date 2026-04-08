/**
 * Environment validation and typed config — formerly published as
 * `@forinda/kickjs-config`. Now lives inside `@forinda/kickjs` so apps
 * pick it up with no extra install. The standalone package will be
 * removed in v3.
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
