import 'reflect-metadata'
import {
  Constructor,
  Scope,
  METADATA,
  type ClassKind,
  type PostConstructStatus,
} from './interfaces'
import { createLogger } from './logger'

const log = createLogger('Container')

/** Internal registration entry that tracks how a dependency should be resolved */
interface Registration {
  target: Constructor
  scope: Scope
  instance?: any
  factory?: () => any
  // Observability fields
  kind: ClassKind
  resolveCount: number
  lastResolvedAt?: number
  firstResolvedAt?: number
  resolveDurationMs?: number
  postConstructStatus: PostConstructStatus
  dependencies: string[]
}

/** Create a Registration with observability defaults */
function createReg(
  fields: Partial<Registration> & Pick<Registration, 'target' | 'scope'>,
): Registration {
  return {
    kind: 'unknown',
    resolveCount: 0,
    postConstructStatus: 'skipped',
    dependencies: [],
    ...fields,
  }
}

/** Format a token for display in error messages */
function tokenName(token: any): string {
  if (typeof token === 'symbol') return token.toString()
  return token?.name || String(token)
}

/**
 * Inversion-of-Control (IoC) container that manages dependency registration,
 * resolution, and lifecycle. Implements the Singleton pattern so all parts of
 * the application share a single container instance.
 *
 * Supports constructor injection, property injection (@Autowired),
 * factory registrations, and lifecycle hooks (@PostConstruct).
 */
export class Container {
  private static instance: Container
  private registrations = new Map<any, Registration>()
  private resolving = new Set<any>()

  /**
   * Persistent replay lists for manual registrations (factory/instance).
   * These survive Container.reset() so adapters' DB/Redis bindings persist across HMR.
   */
  private static factoryRegistrations: Array<{ token: any; factory: () => any; scope: Scope }> = []
  private static instanceRegistrations: Array<{ token: any; instance: any }> = []

  /** Callback set by the decorators module to flush pending registrations */
  static _onReady: ((container: Container) => void) | null = null
  /** Callback invoked on reset so decorators can update their container reference */
  static _onReset: ((container: Container) => void) | null = null
  /**
   * Environment resolver for @Value decorator. Set by @forinda/kickjs-config
   * to return Zod-validated, type-coerced env values instead of raw process.env strings.
   */
  static _envResolver: ((key: string) => any) | null = null
  /**
   * Request store provider for REQUEST-scoped DI. Set by @forinda/kickjs-http
   * to return the current request's AsyncLocalStorage store.
   * Returns { instances: Map, values: Map } or null if outside a request.
   */
  static _requestStoreProvider:
    | (() => { instances: Map<any, any>; values: Map<any, any> } | null)
    | null = null

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container()
    }
    // Flush any decorator registrations that queued before the container existed
    if (Container._onReady) {
      Container._onReady(Container.instance)
      Container._onReady = null
    }
    return Container.instance
  }

  /**
   * Resets the container by replacing the singleton with a fresh instance.
   * Useful for testing to ensure a clean slate between test runs.
   */
  static reset(): void {
    Container.instance = new Container()
    // Notify decorators so they update their container reference
    Container._onReset?.(Container.instance)
    // Replay manual registrations so adapter bindings (DB, Redis) survive HMR
    for (const { token, factory, scope } of Container.factoryRegistrations) {
      if (!Container.instance.has(token)) {
        Container.instance.registrations.set(
          token,
          createReg({ target: Object as any, scope, factory, kind: 'factory' }),
        )
      }
    }
    for (const { token, instance } of Container.instanceRegistrations) {
      if (!Container.instance.has(token)) {
        Container.instance.registrations.set(
          token,
          createReg({
            target: instance.constructor,
            scope: Scope.SINGLETON,
            instance,
            kind: 'instance',
            postConstructStatus: 'completed',
          }),
        )
      }
    }
  }

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
  static create(): Container {
    return new Container()
  }

  /** Register a class constructor under the given token */
  register(token: any, target: Constructor, scope: Scope = Scope.SINGLETON): void {
    const kind: ClassKind = Reflect.getMetadata(METADATA.CLASS_KIND, target) ?? 'unknown'
    const dependencies = this.extractDependencies(target)
    const reg = createReg({ target, scope, kind, dependencies })
    this.registrations.set(token, reg)
    // Store a name-based fallback so HMR class re-creation (new identity)
    // can still resolve by the original class name.
    if (typeof token === 'function' && token.name) {
      this.registrations.set(`__hmr__${token.name}`, reg)
    }
  }

  /** Register a factory function under the given token */
  registerFactory(token: any, factory: () => any, scope: Scope = Scope.SINGLETON): void {
    this.registrations.set(
      token,
      createReg({ target: Object as any, scope, factory, kind: 'factory' }),
    )
    // Track for HMR replay — factory registrations survive Container.reset()
    const idx = Container.factoryRegistrations.findIndex((r) => r.token === token)
    if (idx >= 0) {
      Container.factoryRegistrations[idx] = { token, factory, scope }
    } else {
      Container.factoryRegistrations.push({ token, factory, scope })
    }
  }

  /** Register a pre-constructed singleton instance */
  registerInstance(token: any, instance: any): void {
    this.registrations.set(
      token,
      createReg({
        target: instance.constructor,
        scope: Scope.SINGLETON,
        instance,
        kind: 'instance',
        postConstructStatus: 'completed',
        resolveCount: 1,
        firstResolvedAt: Date.now(),
        lastResolvedAt: Date.now(),
      }),
    )
    // Track for HMR replay — instance registrations survive Container.reset()
    const idx = Container.instanceRegistrations.findIndex((r) => r.token === token)
    if (idx >= 0) {
      Container.instanceRegistrations[idx] = { token, instance }
    } else {
      Container.instanceRegistrations.push({ token, instance })
    }
  }

  /** Check if a binding exists for the given token */
  has(token: any): boolean {
    return this.registrations.has(token)
  }

  /** Return a snapshot of all registered tokens with their scope and instantiation status */
  getRegistrations(): Array<{
    token: string
    scope: string
    kind: ClassKind
    instantiated: boolean
    resolveCount: number
    lastResolvedAt?: number
    firstResolvedAt?: number
    resolveDurationMs?: number
    postConstructStatus: PostConstructStatus
    dependencies: string[]
  }> {
    const entries: Array<ReturnType<Container['getRegistrations']>[number]> = []
    for (const [token, reg] of this.registrations) {
      entries.push({
        token: tokenName(token),
        scope: reg.scope,
        kind: reg.kind,
        // Singletons check cached instance; transients check resolveCount
        instantiated:
          reg.scope === Scope.SINGLETON ? reg.instance !== undefined : reg.resolveCount > 0,
        resolveCount: reg.resolveCount,
        lastResolvedAt: reg.lastResolvedAt,
        firstResolvedAt: reg.firstResolvedAt,
        resolveDurationMs: reg.resolveDurationMs,
        postConstructStatus: reg.postConstructStatus,
        dependencies: reg.dependencies,
      })
    }
    return entries
  }

  /** Resolve a dependency by its token */
  resolve<T = any>(token: any): T {
    let reg = this.registrations.get(token)
    // HMR fallback: when Vite re-evaluates a module, decorated classes get new
    // identity. Try resolving by class name if the primary token lookup fails.
    if (!reg && typeof token === 'function' && token.name) {
      reg = this.registrations.get(`__hmr__${token.name}`)
    }
    if (!reg) {
      throw new Error(`No binding found for: ${tokenName(token)}`)
    }

    if (reg.scope === Scope.SINGLETON && reg.instance !== undefined) {
      reg.resolveCount++
      reg.lastResolvedAt = Date.now()
      return reg.instance
    }

    // REQUEST scope: one instance per HTTP request, cached in AsyncLocalStorage
    if (reg.scope === Scope.REQUEST) {
      if (!Container._requestStoreProvider) {
        throw new Error(
          `Cannot resolve REQUEST-scoped "${tokenName(token)}": no request store provider configured. ` +
            `Ensure requestScopeMiddleware() is in your middleware pipeline.`,
        )
      }
      const store = Container._requestStoreProvider()
      if (!store) {
        throw new Error(
          `Cannot resolve REQUEST-scoped "${tokenName(token)}" outside an HTTP request context.`,
        )
      }
      // Check for pre-registered request values (user, tenant, etc.)
      if (store.values.has(token)) {
        reg.resolveCount++
        reg.lastResolvedAt = Date.now()
        return store.values.get(token) as T
      }
      // Check per-request instance cache
      if (store.instances.has(token)) {
        reg.resolveCount++
        reg.lastResolvedAt = Date.now()
        return store.instances.get(token) as T
      }
      // Create instance and cache for this request only
      const start = performance.now()
      const instance = this.createInstance(reg)
      reg.resolveDurationMs = performance.now() - start
      reg.resolveCount++
      reg.lastResolvedAt = Date.now()
      if (!reg.firstResolvedAt) reg.firstResolvedAt = Date.now()
      store.instances.set(token, instance)
      return instance as T
    }

    if (reg.factory) {
      const start = performance.now()
      const instance = reg.factory()
      reg.resolveDurationMs = performance.now() - start
      reg.resolveCount++
      reg.lastResolvedAt = Date.now()
      if (!reg.firstResolvedAt) reg.firstResolvedAt = Date.now()
      if (reg.scope === Scope.SINGLETON) {
        reg.instance = instance
      }
      return instance
    }

    if (this.resolving.has(token)) {
      const chain = [...this.resolving].map(tokenName)
      chain.push(tokenName(token))
      throw new Error(`Circular dependency detected: ${chain.join(' -> ')}`)
    }
    this.resolving.add(token)

    try {
      const start = performance.now()
      const instance = this.createInstance(reg)
      reg.resolveDurationMs = performance.now() - start
      reg.resolveCount++
      reg.lastResolvedAt = Date.now()
      if (!reg.firstResolvedAt) reg.firstResolvedAt = Date.now()
      if (reg.scope === Scope.SINGLETON) {
        reg.instance = instance
      }
      return instance
    } finally {
      this.resolving.delete(token)
    }
  }

  /** Lifecycle hook called during Application.setup() after module registration */
  bootstrap(): void {
    // Reserved for future use — adapters and modules register via
    // container.register(), registerFactory(), and registerInstance().
  }

  private createInstance(reg: Registration): any {
    const paramTypes: Constructor[] = Reflect.getMetadata(METADATA.PARAM_TYPES, reg.target) || []

    const args = paramTypes.map((paramType, index) => {
      // Check for @Inject token override on constructor parameter
      const injectTokens: Record<number, any> =
        Reflect.getMetadata(METADATA.INJECT, reg.target) || {}
      const token = injectTokens[index] || paramType
      // Scope validation: SINGLETON cannot inject REQUEST-scoped dependencies
      if (reg.scope === Scope.SINGLETON) {
        const depReg = this.registrations.get(token)
        if (depReg && depReg.scope === Scope.REQUEST) {
          throw new Error(
            `Cannot inject REQUEST-scoped "${tokenName(token)}" into SINGLETON "${tokenName(reg.target)}". ` +
              `Singletons outlive requests. Use TRANSIENT or REQUEST scope for the parent.`,
          )
        }
      }
      return this.resolve(token)
    })

    const instance = new reg.target(...args)

    // Property injection via @Autowired
    this.injectProperties(instance, reg.target)

    // @PostConstruct lifecycle hook
    const postConstruct = Reflect.getMetadata(METADATA.POST_CONSTRUCT, reg.target.prototype)
    if (postConstruct && typeof instance[postConstruct] === 'function') {
      try {
        const result = instance[postConstruct]()
        if (result && typeof result.then === 'function') {
          reg.postConstructStatus = 'pending'
          ;(result as Promise<void>)
            .then(() => {
              reg.postConstructStatus = 'completed'
            })
            .catch(() => {
              reg.postConstructStatus = 'failed'
            })
          log.warn(
            `@PostConstruct on ${tokenName(reg.target)}.${String(postConstruct)}() returned a Promise ` +
              `but the container is synchronous. The async operation will not be awaited.`,
          )
        } else {
          reg.postConstructStatus = 'completed'
        }
      } catch (err) {
        reg.postConstructStatus = 'failed'
        log.error(
          err,
          `@PostConstruct on ${tokenName(reg.target)}.${String(postConstruct)}() threw an error`,
        )
      }
    }

    return instance
  }

  /** Extract dependency token names from constructor metadata */
  private extractDependencies(target: Constructor): string[] {
    const paramTypes: Constructor[] = Reflect.getMetadata(METADATA.PARAM_TYPES, target) || []
    const injectTokens: Record<number, any> = Reflect.getMetadata(METADATA.INJECT, target) || {}
    return paramTypes.map((type, index) => {
      const token = injectTokens[index] || type
      return tokenName(token)
    })
  }

  private injectProperties(instance: any, target: Constructor): void {
    // @Autowired — lazy DI property injection
    const autowiredProps: Map<string, any> =
      Reflect.getMetadata(METADATA.AUTOWIRED, target.prototype) || new Map()

    for (const [prop, token] of autowiredProps) {
      const resolvedToken =
        token || Reflect.getMetadata(METADATA.PROPERTY_TYPE, target.prototype, prop)
      if (resolvedToken) {
        Object.defineProperty(instance, prop, {
          get: () => this.resolve(resolvedToken),
          enumerable: true,
          configurable: true,
        })
      }
    }

    // @Value — lazy environment variable injection
    const valueProps: Map<string, { envKey: string; defaultValue?: any }> =
      Reflect.getMetadata(METADATA.VALUE, target.prototype) || new Map()

    for (const [prop, config] of valueProps) {
      Object.defineProperty(instance, prop, {
        get() {
          // Use the registered env resolver if available (set by @forinda/kickjs-config)
          // This returns Zod-validated, type-coerced values (e.g. PORT as number)
          if (Container._envResolver) {
            const val = Container._envResolver(config.envKey)
            if (val !== undefined) return val
          }

          // Fallback to raw process.env for apps not using @forinda/kickjs-config
          const val = process.env[config.envKey]
          if (val !== undefined) return val
          if (config.defaultValue !== undefined) return config.defaultValue
          throw new Error(
            `@Value('${config.envKey}'): Environment variable "${config.envKey}" is not set and no default was provided.`,
          )
        },
        enumerable: true,
        configurable: true,
      })
    }
  }
}
