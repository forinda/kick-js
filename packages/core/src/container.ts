import 'reflect-metadata'
import { Constructor, Scope, METADATA } from './interfaces'

/** Internal registration entry that tracks how a dependency should be resolved */
interface Registration {
  target: Constructor
  scope: Scope
  instance?: any
  factory?: () => any
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
 * factory-based beans (@Bean), and lifecycle hooks (@PostConstruct).
 */
export class Container {
  private static instance: Container
  private registrations = new Map<any, Registration>()
  private resolving = new Set<any>()

  /** Callback set by the decorators module to flush pending registrations */
  static _onReady: ((container: Container) => void) | null = null

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
  }

  /** Register a class constructor under the given token */
  register(token: any, target: Constructor, scope: Scope = Scope.SINGLETON): void {
    this.registrations.set(token, { target, scope })
    // Store a name-based fallback so HMR class re-creation (new identity)
    // can still resolve by the original class name.
    if (typeof token === 'function' && token.name) {
      this.registrations.set(`__hmr__${token.name}`, { target, scope })
    }
  }

  /** Register a factory function under the given token */
  registerFactory(token: any, factory: () => any, scope: Scope = Scope.SINGLETON): void {
    this.registrations.set(token, { target: Object as any, scope, factory })
  }

  /** Register a pre-constructed singleton instance */
  registerInstance(token: any, instance: any): void {
    this.registrations.set(token, {
      target: instance.constructor,
      scope: Scope.SINGLETON,
      instance,
    })
  }

  /** Check if a binding exists for the given token */
  has(token: any): boolean {
    return this.registrations.has(token)
  }

  /** Return a snapshot of all registered tokens with their scope and instantiation status */
  getRegistrations(): Array<{ token: string; scope: string; instantiated: boolean }> {
    const entries: Array<{ token: string; scope: string; instantiated: boolean }> = []
    for (const [token, reg] of this.registrations) {
      entries.push({
        token: tokenName(token),
        scope: reg.scope,
        instantiated: reg.instance !== undefined,
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
      return reg.instance
    }

    if (reg.factory) {
      const instance = reg.factory()
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
      const instance = this.createInstance(reg)
      if (reg.scope === Scope.SINGLETON) {
        reg.instance = instance
      }
      return instance
    } finally {
      this.resolving.delete(token)
    }
  }

  /** Process all @Configuration classes and invoke their @Bean methods */
  bootstrap(): void {
    for (const [, reg] of this.registrations) {
      const isConfig = Reflect.getMetadata(METADATA.CONFIGURATION, reg.target)
      if (isConfig) {
        this.processConfiguration(reg.target)
      }
    }
  }

  private createInstance(reg: Registration): any {
    const paramTypes: Constructor[] = Reflect.getMetadata(METADATA.PARAM_TYPES, reg.target) || []

    const args = paramTypes.map((paramType, index) => {
      // Check for @Inject token override on constructor parameter
      const injectTokens: Record<number, any> =
        Reflect.getMetadata(METADATA.INJECT, reg.target) || {}
      const token = injectTokens[index] || paramType
      return this.resolve(token)
    })

    const instance = new reg.target(...args)

    // Property injection via @Autowired
    this.injectProperties(instance, reg.target)

    // @PostConstruct lifecycle hook
    const postConstruct = Reflect.getMetadata(METADATA.POST_CONSTRUCT, reg.target.prototype)
    if (postConstruct && typeof instance[postConstruct] === 'function') {
      instance[postConstruct]()
    }

    return instance
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

  private processConfiguration(target: Constructor): void {
    const instance = this.resolve(target)
    const prototype = target.prototype

    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') continue
      const beanMeta = Reflect.getMetadata(METADATA.BEAN, prototype, key)
      if (!beanMeta) continue

      const options = Reflect.getMetadata(METADATA.BEAN_OPTIONS, prototype, key) || {}
      const returnType = Reflect.getMetadata(METADATA.RETURN_TYPE, prototype, key)
      const token = returnType || key

      this.registerFactory(token, () => instance[key](), options.scope || Scope.SINGLETON)
    }
  }
}
