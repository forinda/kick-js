import 'reflect-metadata'
import {
  Constructor,
  Scope,
  METADATA,
  type ClassKind,
  type PostConstructStatus,
} from './interfaces'
import { resolveAsset } from './assets'
import { createLogger } from './logger'
import {
  getClassMeta,
  getClassMetaOrUndefined,
  getMetaMap,
  getMetaRecord,
  getMethodMetaOrUndefined,
} from './metadata'
import { isInjectionToken, type InjectionToken } from './token'

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
export function tokenName(token: any): string {
  if (typeof token === 'symbol') return token.toString()
  if (isInjectionToken(token)) return token.name
  return token?.name || String(token)
}

// ── Persistent Store ────────────────────────────────────────────────────
// globalThis-based storage that survives BOTH Container.reset() AND Vite's
// ssrLoadModule() re-evaluation. When Vite re-evaluates a module, the
// Container class gets a new identity (new statics). But globalThis persists.
//
// This is how DB connections, Redis clients, WsAdapter instances, and any
// other stateful bindings survive HMR without being dropped.
//
// Pattern from: React Router (globalThis for state), Vinxi (globalThis.app)

// ── Change Event System ─────────────────────────────────────────────────
// Batched (50ms debounce) so `kick g module` creating 10+ files emits ONE
// notification, not 10. Any adapter can subscribe: Swagger, DevTools, WS, etc.

/** A single container change event */
export interface ContainerChangeEvent {
  token: string
  event: 'registered' | 'resolved' | 'invalidated'
  kind?: ClassKind
  timestamp: number
}

/** Listener that receives batched change events */
export type ContainerChangeListener = (changes: ContainerChangeEvent[]) => void

/**
 * Type-safe registry of string DI tokens. Augmented by `kick typegen` —
 * the generated `.kickjs/types/registry.d.ts` adds entries like:
 *
 * ```ts
 * declare module '@forinda/kickjs' {
 *   interface KickJsRegistry {
 *     UserService: import('../../src/modules/users/user.service').UserService
 *   }
 * }
 * ```
 *
 * Once typegen has run, `container.resolve('UserService')` returns the
 * correct type instead of `any`. Class-token resolution
 * (`container.resolve(UserService)`) is already type-safe via the
 * `Constructor<T>` overload and does not need typegen.
 */
export interface KickJsRegistry {}

interface PersistentStore {
  factories: Array<{ token: any; factory: () => any; scope: Scope }>
  instances: Array<{ token: any; instance: any }>
  /** Resolved instances keyed by string name — survives class identity changes */
  resolvedInstances: Map<string, any>
}

function getPersistentStore(): PersistentStore {
  if (!(globalThis as any).__kickjs_persistent) {
    ;(globalThis as any).__kickjs_persistent = {
      factories: [],
      instances: [],
      resolvedInstances: new Map(),
    } satisfies PersistentStore
  }
  return (globalThis as any).__kickjs_persistent
}

/**
 * Inversion-of-Control (IoC) container that manages dependency registration,
 * resolution, and lifecycle. Implements the Singleton pattern so all parts of
 * the application share a single container instance.
 *
 * Supports constructor injection, property injection (@Autowired),
 * factory registrations, and lifecycle hooks (@PostConstruct).
 *
 * Persistent state (DB connections, Redis, etc.) is stored on globalThis so
 * it survives both Container.reset() and Vite module re-evaluation.
 */
export class Container {
  private static instance: Container
  private registrations = new Map<any, Registration>()
  private resolving = new Set<any>()

  // ── Reactive change tracking ──────────────────────────────────────
  private changeListeners = new Set<ContainerChangeListener>()
  private pendingChanges: ContainerChangeEvent[] = []
  private notifyTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly DEBOUNCE_MS = 50

  /** Callback set by the decorators module to flush pending registrations */
  static _onReady: ((container: Container) => void) | null = null
  /** Callback invoked on reset so decorators can update their container reference */
  static _onReset: ((container: Container) => void) | null = null
  /**
   * Environment resolver for @Value decorator. Set by the unified
   * `@forinda/kickjs` config layer to return Zod-validated, type-coerced
   * env values instead of raw process.env strings.
   */
  static _envResolver: ((key: string) => any) | null = null
  /**
   * Request store provider for REQUEST-scoped DI. Set by the HTTP layer
   * inside `@forinda/kickjs` to return the current request's
   * AsyncLocalStorage store. Returns { instances: Map, values: Map } or
   * null if outside a request.
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
   * Persistent registrations (DB, Redis, etc.) are replayed from globalThis
   * so they survive both reset() and Vite module re-evaluation.
   */
  static reset(): void {
    Container.instance = new Container()
    // Notify decorators so they update their container reference
    Container._onReset?.(Container.instance)
    // Replay persistent registrations from globalThis store
    const store = getPersistentStore()
    for (const { token, factory, scope } of store.factories) {
      if (!Container.instance.has(token)) {
        // Check if we have a previously resolved instance for this token
        const name = tokenName(token)
        const existing = store.resolvedInstances.get(name)
        Container.instance.registrations.set(
          token,
          createReg({
            target: Object as any,
            scope,
            factory,
            kind: 'factory',
            instance: existing, // Reuse resolved instance if available
            resolveCount: existing ? 1 : 0,
            postConstructStatus: existing ? 'completed' : 'skipped',
          }),
        )
      }
    }
    for (const { token, instance } of store.instances) {
      if (!Container.instance.has(token)) {
        Container.instance.registrations.set(
          token,
          createReg({
            target: instance.constructor,
            scope: Scope.SINGLETON,
            instance,
            kind: 'instance',
            postConstructStatus: 'completed',
            resolveCount: 1,
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
    const kind = getClassMeta<ClassKind>(METADATA.CLASS_KIND, target, 'unknown')
    const dependencies = this.extractDependencies(target)
    const reg = createReg({ target, scope, kind, dependencies })
    this.registrations.set(token, reg)
    // Store a name-based fallback so HMR class re-creation (new identity)
    // can still resolve by the original class name.
    if (typeof token === 'function' && token.name) {
      this.registrations.set(`__hmr__${token.name}`, reg)
    }
    this.emit(tokenName(token), 'registered', kind)
  }

  /** Register a factory function under the given token */
  registerFactory(token: any, factory: () => any, scope: Scope = Scope.SINGLETON): void {
    const store = getPersistentStore()
    const name = tokenName(token)
    // Check if we already have a resolved instance from a previous HMR cycle.
    // Only reuse if the factory hasn't changed (same reference). When a new
    // factory is provided (e.g. swapping implementations), clear the stale
    // instance so the new factory runs on next resolve.
    const existingEntry = store.factories.find((r) => tokenName(r.token) === name)
    const factoryUnchanged = existingEntry?.factory === factory
    const existingInstance = factoryUnchanged ? store.resolvedInstances.get(name) : undefined

    // Clear stale resolved instance when factory changes
    if (!factoryUnchanged) {
      store.resolvedInstances.delete(name)
    }

    this.registrations.set(
      token,
      createReg({
        target: Object as any,
        scope,
        factory,
        kind: 'factory',
        instance: existingInstance,
        resolveCount: existingInstance ? 1 : 0,
        postConstructStatus: existingInstance ? 'completed' : 'skipped',
      }),
    )
    // Track in globalThis for persistence across HMR + module re-evaluation
    const idx = store.factories.findIndex((r) => tokenName(r.token) === name)
    if (idx >= 0) {
      store.factories[idx] = { token, factory, scope }
    } else {
      store.factories.push({ token, factory, scope })
    }
    this.emit(name, 'registered', 'factory')
  }

  /** Register a pre-constructed singleton instance */
  registerInstance(token: any, instance: any): void {
    const store = getPersistentStore()
    const name = tokenName(token)

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
    // Track in globalThis for persistence across HMR + module re-evaluation
    store.resolvedInstances.set(name, instance)
    const idx = store.instances.findIndex((r) => tokenName(r.token) === name)
    if (idx >= 0) {
      store.instances[idx] = { token, instance }
    } else {
      store.instances.push({ token, instance })
    }
    this.emit(name, 'registered', 'instance')
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

  /**
   * Resolve a dependency by its token.
   *
   * Four overloads, in order of preference:
   * - **`InjectionToken<T>`** (from `createToken<T>(name)`) → returns `T`.
   *   Collision-safe by construction; no codegen required.
   * - **Class constructor** → returns an instance of that class. Always
   *   type-safe; no codegen required.
   * - **String token in `KickJsRegistry`** (populated by `kick typegen`) →
   *   returns the augmented type.
   * - **Anything else** → returns `any`. Use this only for legacy code or
   *   string tokens that haven't been registered with typegen yet.
   */
  resolve<T>(token: InjectionToken<T>): T
  resolve<T>(token: Constructor<T>): T
  resolve<K extends keyof KickJsRegistry & string>(token: K): KickJsRegistry[K]
  resolve<T = any>(token: any): T
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
        // Persist resolved factory instances so they survive module re-evaluation
        getPersistentStore().resolvedInstances.set(tokenName(token), instance)
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

  // ── Reactive Change API ─────────────────────────────────────────────

  /**
   * Subscribe to container changes. Returns an unsubscribe function.
   *
   * Changes are batched (50ms debounce) so bulk operations like
   * `kick g module` creating 10+ files emit ONE batch, not 10 events.
   *
   * Any adapter can subscribe:
   *   - SwaggerAdapter: re-build spec when controllers change
   *   - DevToolsAdapter: push SSE events to dashboard
   *   - WsAdapter: re-discover namespaces when controllers change
   *   - OtelAdapter: emit tracing spans for DI resolution
   *   - Custom user adapters
   *
   * @example
   * ```ts
   * const unsub = container.onChange((changes) => {
   *   for (const c of changes) {
   *     console.log(`${c.event}: ${c.token} (${c.kind})`)
   *   }
   * })
   * // later:
   * unsub()
   * ```
   */
  onChange(callback: ContainerChangeListener): () => void {
    this.changeListeners.add(callback)
    return () => this.changeListeners.delete(callback)
  }

  /**
   * Invalidate a specific registration. Clears the cached instance so the
   * next resolve() creates a fresh one. Also invalidates dependents
   * (anything that injected this token) by walking the dependency graph.
   *
   * Called by the Vite HMR plugin when a module file changes.
   * Skips persistent registrations (DB connections, etc.).
   */
  invalidate(token: any): void {
    const name = tokenName(token)
    // Try both the token itself and the HMR fallback name
    const reg = this.registrations.get(token) ?? this.registrations.get(`__hmr__${name}`)
    if (!reg) return

    // Don't invalidate persistent registrations (DB, Redis, etc.)
    const store = getPersistentStore()
    if (store.resolvedInstances.has(name)) return

    // Clear cached instance — next resolve() will re-create
    reg.instance = undefined
    reg.resolveCount = 0
    reg.postConstructStatus = 'skipped'
    this.emit(name, 'invalidated', reg.kind)

    // Walk dependency graph — invalidate anything that injected this token
    for (const [depToken, depReg] of this.registrations) {
      if (depReg.dependencies.includes(name)) {
        this.invalidate(depToken)
      }
    }
  }

  /** Batch-emit a change event (debounced, flushed after 50ms of quiet) */
  private emit(token: string, event: ContainerChangeEvent['event'], kind?: ClassKind): void {
    this.pendingChanges.push({ token, event, kind, timestamp: Date.now() })

    if (this.notifyTimer) clearTimeout(this.notifyTimer)
    this.notifyTimer = setTimeout(() => {
      const batch = this.pendingChanges.splice(0)
      if (batch.length === 0) return
      for (const listener of this.changeListeners) {
        try {
          listener(batch)
        } catch {
          // Don't let one broken listener break others
        }
      }
    }, Container.DEBOUNCE_MS)
  }

  /** Flush pending change events immediately (useful in tests) */
  flushChanges(): void {
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer)
      this.notifyTimer = null
    }
    const batch = this.pendingChanges.splice(0)
    if (batch.length === 0) return
    for (const listener of this.changeListeners) {
      try {
        listener(batch)
      } catch {
        // Don't let one broken listener break others
      }
    }
  }

  private createInstance(reg: Registration): any {
    const paramTypes = getClassMeta<Constructor[]>(METADATA.PARAM_TYPES, reg.target, [])

    const args = paramTypes.map((paramType, index) => {
      // Check for @Inject token override on constructor parameter
      const injectTokens = getMetaRecord<any>(METADATA.INJECT, reg.target)
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
    const postConstruct = getClassMetaOrUndefined<string | symbol>(
      METADATA.POST_CONSTRUCT,
      reg.target.prototype,
    )
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
    const paramTypes = getClassMeta<Constructor[]>(METADATA.PARAM_TYPES, target, [])
    const injectTokens = getMetaRecord<any>(METADATA.INJECT, target)
    return paramTypes.map((type, index) => {
      const token = injectTokens[index] || type
      return tokenName(token)
    })
  }

  private injectProperties(instance: any, target: Constructor): void {
    // @Autowired — lazy DI property injection
    const autowiredProps = getMetaMap<string, any>(METADATA.AUTOWIRED, target.prototype)

    for (const [prop, token] of autowiredProps) {
      const resolvedToken =
        token || getMethodMetaOrUndefined(METADATA.PROPERTY_TYPE, target.prototype, prop)
      if (resolvedToken) {
        Object.defineProperty(instance, prop, {
          get: () => this.resolve(resolvedToken),
          enumerable: true,
          configurable: true,
        })
      }
    }

    // @Value — lazy environment variable injection
    const valueProps = getMetaMap<string, { envKey: string; defaultValue?: any }>(
      METADATA.VALUE,
      target.prototype,
    )

    for (const [prop, config] of valueProps) {
      Object.defineProperty(instance, prop, {
        get() {
          // Use the registered env resolver if available (wired by the
          // config layer in @forinda/kickjs). Returns Zod-validated,
          // type-coerced values (e.g. PORT as number).
          if (Container._envResolver) {
            const val = Container._envResolver(config.envKey)
            if (val !== undefined) return val
          }

          // Fallback to raw process.env for apps that haven't called loadEnv()
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

    // @Asset — lazy asset path injection (assets-plan.md). Same lazy-
    // getter pattern as @Value: resolve on every property access via
    // the asset manager's cached resolver, not at class instantiation.
    // Splits the key on the FIRST '/' so `mails/orders/confirmation`
    // becomes namespace=`mails` + key=`orders/confirmation`.
    const assetProps = getMetaMap<string, { assetKey: string }>(METADATA.ASSET, target.prototype)

    if (assetProps.size > 0) {
      for (const [prop, config] of assetProps) {
        const slashIdx = config.assetKey.indexOf('/')
        if (slashIdx === -1) {
          throw new Error(
            `@Asset('${config.assetKey}'): asset key must include a '/' separator (e.g. 'mails/welcome').`,
          )
        }
        const namespace = config.assetKey.slice(0, slashIdx)
        const key = config.assetKey.slice(slashIdx + 1)
        Object.defineProperty(instance, prop, {
          get() {
            return resolveAsset(namespace, key)
          },
          enumerable: true,
          configurable: true,
        })
      }
    }
  }
}
