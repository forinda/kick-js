/**
 * @forinda/kickjs-config — DEPRECATED.
 *
 * Everything that used to live here now ships inside `@forinda/kickjs`
 * (and is also exposed at `@forinda/kickjs/config`). This package is a
 * thin re-export shim kept for one release so existing apps don't break;
 * it will be **removed in v3**. Migrate your imports:
 *
 * ```ts
 * // Before
 * import { defineEnv, loadEnv, ConfigService } from '@forinda/kickjs-config'
 * import { envWatchPlugin } from '@forinda/kickjs-config'
 *
 * // After
 * import { defineEnv, loadEnv, ConfigService } from '@forinda/kickjs'
 * import { envWatchPlugin } from '@forinda/kickjs-vite'
 * ```
 */

export {
  baseEnvSchema,
  defineEnv,
  loadEnv,
  getEnv,
  reloadEnv,
  resetEnvCache,
  ConfigService,
  createConfigService,
  type TypedConfigService,
} from '@forinda/kickjs'

// `Env` lived on the standalone package as the concrete base-schema
// shape (`z.infer<typeof baseEnvSchema>`). The unified `@forinda/kickjs`
// barrel exposes a *generic* `Env<K>` instead — so we pull this one
// from the subpath to keep the exact original shape.
export { type Env } from '@forinda/kickjs/config'

// Vite-only export — this one moved to @forinda/kickjs-vite. We keep
// the local implementation imported so the shim doesn't need to add
// @forinda/kickjs-vite as a dep.
export { envWatchPlugin } from './vite-env-plugin'
