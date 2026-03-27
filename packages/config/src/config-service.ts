import { Service } from '@forinda/kickjs'
import type { z } from 'zod'
import { loadEnv, reloadEnv } from './env'

/** Injectable service for accessing typed environment configuration */
@Service()
export class ConfigService {
  private env: Record<string, any> = loadEnv()

  /** Get an env variable by key */
  get<T = any>(key: string): T {
    return this.env[key] as T
  }

  /** Get all env config (readonly) */
  getAll(): Readonly<Record<string, any>> {
    return Object.freeze({ ...this.env })
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
