import { Service, type EnvKey } from '@forinda/kickjs'
import type { z } from 'zod'
import { loadEnv, reloadEnv } from './env'

/**
 * Constraint that locks the `key` argument to known `EnvKey` literals
 * once `kick typegen` has populated `KickEnv`. Mirrors the same trick
 * used by the `@Value` decorator: when `EnvKey` resolves to `never`
 * (no schema yet), accept any string for back-compat; once typegen
 * has run, require a known key.
 */
type ConfigKey<K extends string> = [EnvKey] extends [never] ? K : K & EnvKey

/**
 * Resolve the return type for a `ConfigService.get(key)` call. When
 * `KickEnv` is populated and the key is a known one, returns the
 * schema-inferred type. Otherwise falls back to the caller-provided
 * generic `T` (default `any`) so existing call sites keep working.
 */
type ConfigValue<K extends string, T> = K extends EnvKey ? KickEnv[K] : T

/**
 * Injectable service for accessing typed environment configuration.
 *
 * Once `kick typegen` has run against your `src/env.ts`, both `get()`
 * and `getAll()` are fully typed against the schema with **no extra
 * setup** — you just inject `ConfigService` and call it:
 *
 * ```ts
 * @Service()
 * class DatabaseService {
 *   @Autowired() private readonly config!: ConfigService
 *
 *   connect() {
 *     const url = this.config.get('DATABASE_URL')   // typed string
 *     const port = this.config.get('PORT')          // typed number
 *     // const bad = this.config.get('NOPE')        // tsc error
 *   }
 * }
 * ```
 *
 * Without typegen the previous `<T = any>` generic still works, so
 * legacy code calling `config.get<string>('DATABASE_URL')` keeps
 * compiling.
 */
@Service()
export class ConfigService {
  private env: Record<string, any> = loadEnv()

  /**
   * Get an env variable by key.
   *
   * - When `kick typegen` has run, `key` is constrained to known
   *   `KickEnv` keys and the return type is inferred from the schema.
   * - When `KickEnv` is empty (no typegen run yet), any string is
   *   accepted and `T` falls back to the explicit generic for
   *   back-compat.
   */
  get<K extends string, T = any>(key: ConfigKey<K>): ConfigValue<K, T> {
    return this.env[key] as ConfigValue<K, T>
  }

  /**
   * Get all env config as a readonly object. When `KickEnv` is
   * populated by typegen, returns `Readonly<KickEnv>` so the caller
   * gets autocomplete on every key.
   */
  getAll(): [EnvKey] extends [never] ? Readonly<Record<string, any>> : Readonly<KickEnv> {
    return Object.freeze({ ...this.env }) as any
  }

  /** Reload env from .env file (for HMR / file-watch scenarios) */
  reload(): void {
    reloadEnv()
    this.env = loadEnv()
  }

  isProduction(): boolean {
    return this.env.NODE_ENV === 'production'
  }

  isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development'
  }

  isTest(): boolean {
    return this.env.NODE_ENV === 'test'
  }
}

/**
 * Typed config service interface — provides autocomplete for env keys.
 * Use with `createConfigService()` for full type safety.
 */
export interface TypedConfigService<TEnv extends Record<string, any>> {
  get<K extends string & keyof TEnv>(key: K): TEnv[K]
  getAll(): Readonly<TEnv>
  reload(): void
  isProduction(): boolean
  isDevelopment(): boolean
  isTest(): boolean
}

/**
 * Create a typed ConfigService class bound to a specific Zod env schema.
 * The returned class is DI-injectable via `@Service()` and provides
 * fully typed `get()` with key autocomplete.
 *
 * @example
 * ```ts
 * const envSchema = defineEnv((base) =>
 *   base.extend({
 *     DATABASE_URL: z.string().url(),
 *     JWT_SECRET: z.string().min(32),
 *   })
 * )
 *
 * // Create a typed, injectable config service
 * export const AppConfigService = createConfigService(envSchema)
 * export type AppConfigService = InstanceType<typeof AppConfigService>
 *
 * // In a controller or service — inject it:
 * @Controller('/users')
 * class UserController {
 *   constructor(@Inject(AppConfigService) private config: AppConfigService) {
 *     const dbUrl = config.get('DATABASE_URL')  // string — autocompletes!
 *     const bad = config.get('NOPE')             // TS error
 *   }
 * }
 * ```
 */
export function createConfigService<T extends z.ZodObject<any>>(schema: T) {
  type TEnv = z.infer<T>

  @Service()
  class SchemaConfigService implements TypedConfigService<TEnv> {
    private env: TEnv = loadEnv(schema)

    get<K extends string & keyof TEnv>(key: K): TEnv[K] {
      return this.env[key]
    }

    getAll(): Readonly<TEnv> {
      return Object.freeze({ ...this.env })
    }

    reload(): void {
      reloadEnv()
      this.env = loadEnv(schema)
    }

    isProduction(): boolean {
      return this.env.NODE_ENV === 'production'
    }

    isDevelopment(): boolean {
      return this.env.NODE_ENV === 'development'
    }

    isTest(): boolean {
      return this.env.NODE_ENV === 'test'
    }
  }

  return SchemaConfigService as {
    new (): TypedConfigService<TEnv>
  }
}
