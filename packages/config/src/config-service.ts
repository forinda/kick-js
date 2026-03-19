import { Service } from '@forinda/kickjs-core'
import { loadEnv } from './env'

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
