import 'reflect-metadata'
import { Constructor, Scope } from './interfaces'
/**
 * Inversion-of-Control (IoC) container that manages dependency registration,
 * resolution, and lifecycle. Implements the Singleton pattern so all parts of
 * the application share a single container instance.
 *
 * Supports constructor injection, property injection (@Autowired),
 * factory registrations, and lifecycle hooks (@PostConstruct).
 */
export declare class Container {
  private static instance
  private registrations
  private resolving
  /** Callback set by the decorators module to flush pending registrations */
  static _onReady: ((container: Container) => void) | null
  /** Callback invoked on reset so decorators can update their container reference */
  static _onReset: ((container: Container) => void) | null
  /**
   * Environment resolver for @Value decorator. Set by @forinda/kickjs-config
   * to return Zod-validated, type-coerced env values instead of raw process.env strings.
   */
  static _envResolver: ((key: string) => any) | null
  static getInstance(): Container
  /**
   * Resets the container by replacing the singleton with a fresh instance.
   * Useful for testing to ensure a clean slate between test runs.
   */
  static reset(): void
  /**
   * Create an isolated container instance (not the global singleton).
   * Useful for concurrent tests that must not share DI state.
   *
   * @example
   * ```ts
   * const container = Container.create()
   * container.register(UserService, UserService)
   * const svc = container.resolve(UserService)
   * ```
   */
  static create(): Container
  /** Register a class constructor under the given token */
  register(token: any, target: Constructor, scope?: Scope): void
  /** Register a factory function under the given token */
  registerFactory(token: any, factory: () => any, scope?: Scope): void
  /** Register a pre-constructed singleton instance */
  registerInstance(token: any, instance: any): void
  /** Check if a binding exists for the given token */
  has(token: any): boolean
  /** Return a snapshot of all registered tokens with their scope and instantiation status */
  getRegistrations(): Array<{
    token: string
    scope: string
    instantiated: boolean
  }>
  /** Resolve a dependency by its token */
  resolve<T = any>(token: any): T
  /** Lifecycle hook called during Application.setup() after module registration */
  bootstrap(): void
  private createInstance
  private injectProperties
}
//# sourceMappingURL=container.d.ts.map
