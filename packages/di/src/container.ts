import 'reflect-metadata'
import {
  Constructor,
  Scope,
  DI_METADATA as METADATA,
  type ClassKind,
  type PostConstructStatus,
} from './interfaces'
import { diError, defaultLogger, type DiErrorCode, type DiLogger } from './errors'
import {
  getClassMeta,
  getClassMetaOrUndefined,
  getMetaMap,
  getMetaRecord,
  getMethodMetaOrUndefined,
} from './metadata'
import { isInjectionToken, type InjectionToken } from './token'

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
  /** Lazily built instantiation plan — see {@link Container.buildPlan}. */
  plan?: InstantiationPlan
}

/**
 * Precomputed instantiation recipe for a class. Class metadata is immutable
 * after definition, so the Reflect reads (5 per create) and the derived
 * structures only need computing ONCE — previously they re-ran on every
 * REQUEST-scoped resolve (i.e. every request) and every TRANSIENT resolve.
 */
interface InstantiationPlan {
  /** Ordered, validated constructor parameter tokens. */
  ctorTokens: any[]
  /** `@Autowired` properties: [property, resolved token]. */
  autowired: Array<[string, any]>
  /** `@Value` properties: [property, env config]. */
  values: Array<[string, { envKey: string; defaultValue?: any }]>
  /** Host-injected properties (`_propertyInjectors`): [property, getter]. */
  injected: Array<[string, () => unknown]>
  /** `@PostConstruct` method name, if any. */
  postConstruct?: string | symbol
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
 * Type-safe registry of string DI tokens. Augment it so
 * `container.resolve('UserService')` returns the right type instead of `any`:
 *
 * ```ts
 * declare module '@forinda/kickjs-di' {
 *   interface KickJsRegistry {
 *     UserService: import('./user.service').UserService
 *   }
 * }
 * ```
 *
 * Class tokens (`container.resolve(UserService)`) and `createToken<T>()`
 * tokens are typed already. In KickJS, `kick typegen` writes this augmentation.
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
/** Builds an error from a stable code and its subject (a token name or env key). */
export type ErrorFactory = (code: DiErrorCode, subject: string) => Error
/** Resolves an env key for `@Value`. */
export type EnvResolver = (key: string) => unknown
/** One unit of work's REQUEST-scoped state: per-token instances, and values set up front. */
export interface RequestStore {
  instances: Map<unknown, unknown>
  values: Map<unknown, unknown>
}
/** The current {@link RequestStore}, or null outside a unit of work. */
export type RequestStoreProvider = () => RequestStore | null
/** Prepares one decorated property: returns the getter its reads go through. */
export type PropertyInjector = (config: any, prop: string) => () => unknown

/**
 * The container's process-wide hooks, set through `Container.set*`. Kept out
 * of the class so they're not part of its public shape.
 */
const hooks = {
  logger: defaultLogger as DiLogger,
  errorFactory: diError as ErrorFactory,
  envResolver: null as EnvResolver | null,
  requestStoreProvider: null as RequestStoreProvider | null,
  propertyInjectors: new Map<string, PropertyInjector>(),
  /** The decorators module's: flush registrations queued before the container existed. */
  onReady: null as ((container: Container) => void) | null,
  /** The decorators module's: re-target and re-seed after a reset. */
  onReset: null as ((container: Container) => void) | null,
  /**
   * The decorators module's: seed a NEWLY CREATED container with the decorator
   * registrations, without adopting it as the global one. `onReset` does both;
   * an isolated container must only have the first half, or it would capture
   * every subsequent decorator registration in the process.
   */
  onCreate: null as ((container: Container) => void) | null,
}

/**
 * Wire the decorators module into the container's lifecycle. Package-internal:
 * not exported from the entry point.
 */
export function installDecoratorHooks(decoratorHooks: {
  onReady: (container: Container) => void
  onReset: (container: Container) => void
  onCreate: (container: Container) => void
}): void {
  Object.assign(hooks, decoratorHooks)
}

export class Container {
  private static instance: Container
  private registrations = new Map<any, Registration>()
  /**
   * Bindings from {@link registerFallback}, kept apart from `registrations`
   * so a normal binding wins whenever it arrives and `has()` keeps answering
   * "did the app bind its own?".
   */
  private fallbacks = new Map<any, Registration>()
  private resolving = new Set<any>()

  // ── Reactive change tracking ──────────────────────────────────────
  private changeListeners = new Set<ContainerChangeListener>()
  private pendingChanges: ContainerChangeEvent[] = []
  private notifyTimer: ReturnType<typeof setTimeout> | null = null
  private static readonly DEBOUNCE_MS = 50

  /**
   * Whether this container is the global singleton.
   *
   * The persistent store exists to carry the GLOBAL container's registrations
   * across HMR and module re-evaluation. An isolated container is per-test and
   * must neither write to it — a `registerInstance` override was replayed into
   * every later `Container.reset()` — nor read from it, which would pull global
   * state into a container created to be free of it.
   */
  private isGlobal = false

  /** The container a child falls back to; null for a root. */
  private parent: Container | null = null
  /** Children, held weakly: one never disposed can still be collected. */
  private children: Set<WeakRef<Container>> | null = null
  /**
   * A child's own keys into the request store, one per token, so its
   * REQUEST-scoped instances never share the parent's under the same token.
   */
  private requestKeys: Map<any, object> | null = null

  /**
   * Where non-fatal problems go: an async `@PostConstruct`, one that threw.
   * Default: errors to `console.error`, warnings dropped. Change it with
   * {@link Container.setLogger}.
   */
  static get logger(): DiLogger {
    return hooks.logger
  }

  /** Send the container's warnings and errors to `logger`; `null` restores the default. */
  static setLogger(logger: DiLogger | null): void {
    hooks.logger = logger ?? defaultLogger
  }

  /**
   * Builds the container's errors from a stable code and the token name (or
   * env key). Default: {@link diError}, a plain `DiError`.
   */
  static get errorFactory(): ErrorFactory {
    return hooks.errorFactory
  }

  /** Build the container's errors yourself, from their codes; `null` restores the default. */
  static setErrorFactory(factory: ErrorFactory | null): void {
    hooks.errorFactory = factory ?? diError
  }

  /**
   * Resolves `@Value(key)`. Without one, `@Value` reads `process.env`, then
   * the declared default.
   */
  static get envResolver(): EnvResolver | null {
    return hooks.envResolver
  }

  /** Resolve `@Value(key)` through `resolver` — validated, typed config, say; `null` removes it. */
  static setEnvResolver(resolver: EnvResolver | null): void {
    hooks.envResolver = resolver
  }

  /**
   * Returns the current unit of work's store for `Scope.REQUEST`, or null
   * outside one. Without a provider, resolving a REQUEST-scoped token throws.
   */
  static get requestStoreProvider(): RequestStoreProvider | null {
    return hooks.requestStoreProvider
  }

  /** Open `Scope.REQUEST` to the store `provider` returns; `null` removes it. */
  static setRequestStoreProvider(provider: RequestStoreProvider | null): void {
    hooks.requestStoreProvider = provider
  }

  /**
   * A lazy property decorator of your own. For each property a class stores
   * under `metadataKey` (a `Map` on the prototype, as `@Value` does),
   * `prepare(config, prop)` runs once when the class's plan is built — so it
   * can reject a bad config up front — and returns the getter each instance's
   * property reads through. Defining a key again replaces it.
   */
  static definePropertyInjector(metadataKey: string, prepare: PropertyInjector): void {
    hooks.propertyInjectors.set(metadataKey, prepare)
  }

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container()
      Container.instance.isGlobal = true
    }
    // Flush any decorator registrations that queued before the container existed
    if (hooks.onReady) {
      const onReady = hooks.onReady
      hooks.onReady = null
      onReady(Container.instance)
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
    Container.instance.isGlobal = true
    // Notify decorators so they update their container reference
    hooks.onReset?.(Container.instance)
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
    const container = new Container()
    // Decorators register at class-definition time, into whichever container
    // was global then. Without this replay an isolated container is missing
    // every @Service / @Repository / @Controller in the process — and
    // `isolated: true` is what the generated docs recommend for test
    // isolation, so the failure reached adopters as `No provider for X`.
    hooks.onCreate?.(container)
    return container
  }

  /**
   * A container that resolves its own bindings first and falls back to this
   * one for everything else: overrides for one tenant, job or test, without
   * touching this container.
   *
   * - An override reaches what the child itself builds. A class registered
   *   only here is built here, with this container's bindings — to have the
   *   child build it with its overrides, register the class in the child too
   *   (`child.register(Service, Service)`).
   * - A child's REQUEST-scoped instances are its own, apart from this
   *   container's in the same request.
   * - When a binding here is invalidated (HMR), what the child built on it is
   *   rebuilt on its next resolve.
   * - `dispose()` detaches the child. One that is never disposed is still
   *   garbage-collected once nothing references it.
   */
  createChild(): Container {
    const child = new Container()
    child.parent = this
    child.requestKeys = new Map()
    ;(this.children ??= new Set()).add(new WeakRef(child))
    return child
  }

  /** Detach a child from its parent and drop the instances it built. */
  dispose(): void {
    const parent = this.parent
    parent?.forEachChild((child, ref) => {
      if (child === this) parent.children!.delete(ref)
    })
    this.parent = null
    for (const reg of this.registrations.values()) reg.instance = undefined
    this.registrations.clear()
    this.fallbacks.clear()
    this.requestKeys?.clear()
  }

  private forEachChild(visit: (child: Container, ref: WeakRef<Container>) => void): void {
    if (!this.children) return
    for (const ref of this.children) {
      const child = ref.deref()
      if (child) visit(child, ref)
      else this.children.delete(ref)
    }
  }

  /** The request-store key for `token`: the token itself for a root, the child's own key for a child. */
  private requestKey(token: any): any {
    if (!this.requestKeys) return token
    let key = this.requestKeys.get(token)
    if (!key) this.requestKeys.set(token, (key = { token }))
    return key
  }

  /** A parent's binding `name` changed: rebuild what this child built on it, and tell its children. */
  private invalidateDependentsOf(name: string): void {
    for (const [token, reg] of this.registrations) {
      if (reg.dependencies.includes(name)) this.invalidate(token)
    }
    this.forEachChild((child) => child.invalidateDependentsOf(name))
  }

  /** Register a class constructor under the given token */
  register(token: any, target: Constructor, scope: Scope = Scope.SINGLETON): void {
    this.assertFallbackUnused(token)
    const kind = getClassMeta<ClassKind>(METADATA.CLASS_KIND, target, 'unknown')
    const dependencies = this.extractDependencies(target)
    const reg = createReg({ target, scope, kind, dependencies })
    this.registrations.set(token, reg)
    // Store a name-based fallback so HMR class re-creation (new identity)
    // can still resolve by the original class name.
    if (typeof token === 'function' && token.name) {
      this.registrations.set(`__hmr__${token.name}`, reg)
    }
    this.emit(token, 'registered', kind)
  }

  /** Register a factory function under the given token */
  registerFactory(token: any, factory: () => any, scope: Scope = Scope.SINGLETON): void {
    this.assertFallbackUnused(token)
    const store = getPersistentStore()
    const name = tokenName(token)
    // Check if we already have a resolved instance from a previous HMR cycle.
    // Only reuse if the factory hasn't changed (same reference). When a new
    // factory is provided (e.g. swapping implementations), clear the stale
    // instance so the new factory runs on next resolve.
    // Reads are global-only too. An isolated container adopting a cached
    // instance from the global store would be contaminated on creation — the
    // same leak, in the other direction.
    const existingEntry = this.isGlobal
      ? store.factories.find((r) => tokenName(r.token) === name)
      : undefined
    const factoryUnchanged = existingEntry?.factory === factory
    const existingInstance =
      this.isGlobal && factoryUnchanged ? store.resolvedInstances.get(name) : undefined

    // Clear stale resolved instance when factory changes
    if (this.isGlobal && !factoryUnchanged) {
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
    // Track in globalThis for persistence across HMR + module re-evaluation —
    // global container only, or an isolated container's factories are replayed
    // into the next Container.reset().
    if (this.isGlobal) {
      const idx = store.factories.findIndex((r) => tokenName(r.token) === name)
      if (idx >= 0) {
        store.factories[idx] = { token, factory, scope }
      } else {
        store.factories.push({ token, factory, scope })
      }
    }
    this.emit(name, 'registered', 'factory')
  }

  /** Register a pre-constructed singleton instance */
  registerInstance(token: any, instance: any): void {
    this.assertFallbackUnused(token)
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
    // Track in globalThis for persistence across HMR + module re-evaluation —
    // global container only. An isolated one that wrote here had its overrides
    // replayed into the next Container.reset().
    if (this.isGlobal) {
      store.resolvedInstances.set(name, instance)
      const idx = store.instances.findIndex((r) => tokenName(r.token) === name)
      if (idx >= 0) {
        store.instances[idx] = { token, instance }
      } else {
        store.instances.push({ token, instance })
      }
    }
    this.emit(name, 'registered', 'instance')
  }

  /**
   * Register a default for `token`, used only while nothing else binds it.
   *
   * `resolve()` prefers a `register` / `registerFactory` / `registerInstance`
   * binding whenever it was made — before or after this call — and falls back
   * to this factory otherwise. `has()` stays `false` for a token that only has
   * a fallback. A second fallback for the same token replaces the first, while
   * the first has not been resolved.
   *
   * Binding the token normally once its SINGLETON fallback has been resolved
   * throws KICK010: whoever resolved it holds the fallback instance, and would
   * disagree with everyone resolving the new binding. Fallbacks are not kept
   * across `Container.reset()` — register them from a hook that runs on every
   * boot (an adapter's `beforeMount`, a module's `register`).
   */
  registerFallback<T>(
    token: InjectionToken<T> | Constructor<T> | string | symbol,
    factory: () => NoInfer<T>,
    scope: Scope = Scope.SINGLETON,
  ): void {
    this.assertFallbackUnused(token)
    this.fallbacks.set(token, createReg({ target: Object as any, scope, factory, kind: 'factory' }))
    if (!this.registrations.has(token)) this.emit(token, 'registered', 'factory')
  }

  /** A fallback whose singleton is already out there can't be replaced. */
  private assertFallbackUnused(token: any): void {
    if (this.fallbacks.get(token)?.instance !== undefined) {
      throw hooks.errorFactory('KICK010', tokenName(token))
    }
  }

  /** The binding `resolve(token)` uses: a normal registration, else the fallback — a child's, then its parent's. */
  private binding(token: any): Registration | undefined {
    return (
      this.registrations.get(token) ??
      (this.parent?.has(token) ? this.parent.binding(token) : undefined) ??
      this.fallbacks.get(token) ??
      this.parent?.binding(token)
    )
  }

  /**
   * Check if a binding exists for the given token — here or, for a child, in
   * a parent. A {@link registerFallback} alone does not count.
   */
  has(token: any): boolean {
    return this.registrations.has(token) || (this.parent?.has(token) ?? false)
  }

  /** Check if this container itself binds the token, not a parent. */
  hasOwn(token: any): boolean {
    return this.registrations.has(token)
  }

  /**
   * Return a snapshot of all registered tokens with their scope and instantiation status.
   * A token served by its {@link registerFallback} is listed with `fallback: true`;
   * a fallback that a normal binding overrides is not listed.
   */
  getRegistrations(): Array<{
    token: string
    fallback?: true
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
    const active = [...this.registrations]
    for (const [token, reg] of this.fallbacks) {
      if (!this.registrations.has(token)) active.push([token, reg])
    }
    for (const [token, reg] of active) {
      entries.push({
        token: tokenName(token),
        ...(this.fallbacks.get(token) === reg && { fallback: true as const }),
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
    // A child: its own binding, then its parent's; its own fallback, then its parent's.
    if (!reg && this.parent?.has(token)) return this.parent.resolve<T>(token)
    reg ??= this.fallbacks.get(token)
    if (!reg && this.parent) return this.parent.resolve<T>(token)
    if (!reg) {
      throw hooks.errorFactory('KICK001', tokenName(token))
    }

    if (reg.scope === Scope.SINGLETON && reg.instance !== undefined) {
      reg.resolveCount++
      reg.lastResolvedAt = Date.now()
      this.emit(token, 'resolved', reg.kind)
      return reg.instance
    }

    // REQUEST scope: one instance per HTTP request, cached in AsyncLocalStorage
    if (reg.scope === Scope.REQUEST) {
      if (!hooks.requestStoreProvider) {
        throw hooks.errorFactory('KICK002', tokenName(token))
      }
      const store = hooks.requestStoreProvider()
      if (!store) {
        throw hooks.errorFactory('KICK003', tokenName(token))
      }
      // Check for pre-registered request values (user, tenant, etc.)
      if (store.values.has(token)) {
        reg.resolveCount++
        reg.lastResolvedAt = Date.now()
        this.emit(token, 'resolved', reg.kind)
        return store.values.get(token) as T
      }
      // Check per-request instance cache — under this container's own key
      const key = this.requestKey(token)
      if (store.instances.has(key)) {
        reg.resolveCount++
        reg.lastResolvedAt = Date.now()
        this.emit(token, 'resolved', reg.kind)
        return store.instances.get(key) as T
      }
      // Factory-registered binding: invoke the factory once per request
      // and cache the result alongside class-instantiated REQUEST tokens.
      // Without this branch, registerFactory(token, fn, Scope.REQUEST)
      // silently falls through to createInstance(reg) which `new`s the
      // factory's placeholder `target: Object` and returns an empty {}
      // — the factory function never runs.
      if (reg.factory) {
        const start = performance.now()
        const instance = reg.factory()
        reg.resolveDurationMs = performance.now() - start
        reg.resolveCount++
        reg.lastResolvedAt = Date.now()
        if (!reg.firstResolvedAt) reg.firstResolvedAt = Date.now()
        store.instances.set(key, instance)
        this.emit(token, 'resolved', reg.kind)
        return instance as T
      }
      // Create instance and cache for this request only
      const start = performance.now()
      const instance = this.createInstance(reg)
      reg.resolveDurationMs = performance.now() - start
      reg.resolveCount++
      reg.lastResolvedAt = Date.now()
      if (!reg.firstResolvedAt) reg.firstResolvedAt = Date.now()
      store.instances.set(key, instance)
      this.emit(token, 'resolved', reg.kind)
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
        // Persist resolved factory instances so they survive module
        // re-evaluation — global container only, for the same reason.
        if (this.isGlobal) {
          getPersistentStore().resolvedInstances.set(tokenName(token), instance)
        }
      }
      this.emit(token, 'resolved', reg.kind)
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
      this.emit(token, 'resolved', reg.kind)
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
  invalidate(token: any, visited = new Set<Registration>()): void {
    const name = tokenName(token)
    // Try both the token itself and the HMR fallback name
    const reg =
      this.registrations.get(token) ??
      this.registrations.get(`__hmr__${name}`) ??
      this.fallbacks.get(token)
    // `visited`: two classes that @Autowired each other depend on each other,
    // and the walk below went round that cycle until the stack overflowed.
    if (!reg || visited.has(reg)) return
    visited.add(reg)

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
        this.invalidate(depToken, visited)
      }
    }
    // And whatever a child built on it.
    this.forEachChild((child) => child.invalidateDependentsOf(name))
  }

  /**
   * Batch-emit a change event (debounced, flushed after 50ms of quiet).
   * Takes the RAW token — `tokenName()` is only computed after the
   * zero-listener guard, so the hot cached-singleton resolve path never pays
   * the name derivation when nobody is watching (the production default).
   */
  private emit(rawToken: any, event: ContainerChangeEvent['event'], kind?: ClassKind): void {
    // Zero-listener fast path. Nobody subscribes to container changes unless
    // DevTools (or a test) calls `onChange` — the production default. Without
    // this guard, every `resolve()` (including the hot cached-singleton path)
    // would scan `pendingChanges`, push an entry, and reschedule a `setTimeout`
    // only for the eventual flush to iterate an empty listener set and discard
    // the batch. Short-circuiting here keeps `resolve()` allocation- and
    // timer-free when no one is watching. When a listener attaches later,
    // subsequent emits work exactly as before — past resolves had no observer
    // to notify anyway.
    if (this.changeListeners.size === 0) return
    const token = tokenName(rawToken)

    // Dedupe within the pending batch: a high-throughput TRANSIENT
    // token that resolves 1000× per request would otherwise queue
    // 1000 identical 'resolved' events. The downstream listener only
    // cares that the token's state changed, so collapse to one entry
    // (the earliest timestamp wins; the latest update is reflected
    // in resolveCount/lastResolvedAt on the registration itself,
    // which the listener reads at notify time).
    const existing = this.pendingChanges.find((p) => p.token === token && p.event === event)
    if (existing) {
      existing.timestamp = Date.now()
    } else {
      this.pendingChanges.push({ token, event, kind, timestamp: Date.now() })
    }

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
    // Don't let a pending debounce window hold the event loop open — flush is
    // best-effort telemetry, not critical work.
    this.notifyTimer.unref?.()
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

  /**
   * Build the one-time instantiation plan for a registration. Runs on the
   * FIRST createInstance for the class — the metadata it reads is immutable
   * after class definition, so every later create (REQUEST scope: every
   * request) skips all Reflect reads and re-derivation.
   *
   * Scope validation (SINGLETON must not ctor-inject REQUEST) lives here
   * too: it's a static property of the (parent, dep) registration pair, so
   * checking it once at plan build is equivalent to the old per-create loop.
   */
  private buildPlan(reg: Registration): InstantiationPlan {
    const paramTypes = getClassMeta<Constructor[]>(METADATA.PARAM_TYPES, reg.target, [])
    const injectTokens = getMetaRecord<any>(METADATA.INJECT, reg.target)

    // When emitDecoratorMetadata is unavailable (tsx, ts-node without
    // SWC), paramTypes is empty even though @Inject set tokens on
    // specific constructor indices. Derive the constructor arity from
    // the @Inject metadata so constructor injection still works.
    const maxInjectIndex =
      Object.keys(injectTokens).length > 0
        ? Math.max(...Object.keys(injectTokens).map(Number)) + 1
        : 0
    const paramCount = Math.max(paramTypes.length, maxInjectIndex)

    const ctorTokens: any[] = []
    for (let index = 0; index < paramCount; index++) {
      const token = injectTokens[index] || paramTypes[index]
      if (!token) {
        throw new Error(
          `Cannot resolve constructor parameter at index ${index} of ${tokenName(reg.target)}. ` +
            `No @Inject token and no design:paramtypes metadata (tsx/ts-node don't emit it). ` +
            `Add @Inject(Token) to every constructor parameter.`,
        )
      }
      // Scope validation: SINGLETON cannot inject REQUEST-scoped dependencies
      if (reg.scope === Scope.SINGLETON) {
        const depReg = this.binding(token)
        if (depReg && depReg.scope === Scope.REQUEST) {
          // The fix depends on the parent: @Controller() takes no options and
          // is always SINGLETON, so "change the parent's scope" is advice a
          // controller cannot follow. @Autowired works for every parent — its
          // getter re-resolves REQUEST deps per access (injectProperties).
          const parent = tokenName(reg.target)
          const dep = tokenName(token)
          const kind = getClassMetaOrUndefined<ClassKind>(METADATA.CLASS_KIND, reg.target)
          const fix =
            kind === 'controller'
              ? `@Controller() is always SINGLETON, so inject "${dep}" with @Autowired() instead of the constructor.`
              : `Give "${parent}" TRANSIENT or REQUEST scope (e.g. @Service({ scope: Scope.REQUEST })), ` +
                `or inject "${dep}" with @Autowired() instead of the constructor.`
          throw new Error(
            `Cannot inject REQUEST-scoped "${dep}" into SINGLETON "${parent}". ` +
              `Singletons outlive requests. ${fix}`,
          )
        }
      }
      ctorTokens.push(token)
    }

    // @Autowired properties — resolve each property's token once.
    const autowiredProps = getMetaMap<string, any>(METADATA.AUTOWIRED, reg.target.prototype)
    const autowired: InstantiationPlan['autowired'] = []
    for (const [prop, token] of autowiredProps) {
      const resolvedToken =
        token || getMethodMetaOrUndefined(METADATA.PROPERTY_TYPE, reg.target.prototype, prop)
      if (resolvedToken) autowired.push([prop, resolvedToken])
    }

    // @Value properties.
    const valueProps = getMetaMap<string, { envKey: string; defaultValue?: any }>(
      METADATA.VALUE,
      reg.target.prototype,
    )
    const values: InstantiationPlan['values'] = [...valueProps.entries()]

    // Properties added by host injectors (`_propertyInjectors`), e.g. `@Asset`.
    const injected: InstantiationPlan['injected'] = []
    for (const [key, prepare] of hooks.propertyInjectors) {
      for (const [prop, config] of getMetaMap<string, unknown>(key, reg.target.prototype)) {
        injected.push([prop, prepare(config, prop)])
      }
    }

    const postConstruct = getClassMetaOrUndefined<string | symbol>(
      METADATA.POST_CONSTRUCT,
      reg.target.prototype,
    )

    return { ctorTokens, autowired, values, injected, postConstruct }
  }

  private createInstance(reg: Registration): any {
    const plan = (reg.plan ??= this.buildPlan(reg))

    const args: any[] = []
    for (const token of plan.ctorTokens) {
      args.push(this.resolve(token))
    }

    const instance = new reg.target(...args)

    // Property injection via @Autowired / @Value / @Asset
    this.injectProperties(instance, plan)

    // @PostConstruct lifecycle hook
    const postConstruct = plan.postConstruct
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
          hooks.logger.warn(
            `@PostConstruct on ${tokenName(reg.target)}.${String(postConstruct)}() returned a Promise ` +
              `but the container is synchronous. The async operation will not be awaited.`,
          )
        } else {
          reg.postConstructStatus = 'completed'
        }
      } catch (err) {
        reg.postConstructStatus = 'failed'
        hooks.logger.error(
          err,
          `@PostConstruct on ${tokenName(reg.target)}.${String(postConstruct)}() threw an error`,
        )
      }
    }

    return instance
  }

  /**
   * Extract every dependency token name a class declares — both
   * constructor params (`@Inject` + emitted `design:paramtypes`) and
   * `@Autowired` properties (read lazily at injection time, but
   * captured here so devtools surfaces a complete dependency graph).
   *
   * Without the property branch, classes that rely entirely on
   * `@Autowired` show `dependencies: []` in the introspection panel
   * even though they have real DI deps — see /_debug topology.
   */
  private extractDependencies(target: Constructor): string[] {
    const paramTypes = getClassMeta<Constructor[]>(METADATA.PARAM_TYPES, target, [])
    const injectTokens = getMetaRecord<any>(METADATA.INJECT, target)
    const ctorDeps = paramTypes.map((type, index) => {
      const token = injectTokens[index] || type
      return tokenName(token)
    })

    // @Autowired properties live on `target.prototype`. Token may be
    // explicit (`@Autowired('SOME_TOKEN')`) or fall back to the
    // emitted `design:type` metadata of the property.
    const autowiredProps = getMetaMap<string, any>(METADATA.AUTOWIRED, target.prototype)
    const propDeps: string[] = []
    for (const [prop, token] of autowiredProps) {
      const resolvedToken =
        token || getMethodMetaOrUndefined(METADATA.PROPERTY_TYPE, target.prototype, prop)
      if (resolvedToken) propDeps.push(tokenName(resolvedToken))
    }

    // De-dupe — a class can declare the same token in both surfaces.
    return [...new Set([...ctorDeps, ...propDeps])]
  }

  private injectProperties(instance: any, plan: InstantiationPlan): void {
    // @Autowired — lazy DI property injection. The getter re-resolves per
    // access by design (a SINGLETON may lazily read a REQUEST-scoped dep at
    // call time). For SINGLETON deps that laziness buys nothing after the
    // first read — the container returns the same cached instance forever —
    // so the getter memoizes itself into a plain data property then. REQUEST
    // and TRANSIENT deps keep the live getter (memoizing would pin the first
    // request's instance across requests).
    for (const [prop, resolvedToken] of plan.autowired) {
      Object.defineProperty(instance, prop, {
        get: () => {
          const value = this.resolve(resolvedToken)
          const depReg = this.binding(resolvedToken)
          if (depReg?.scope === Scope.SINGLETON) {
            Object.defineProperty(instance, prop, {
              value,
              enumerable: true,
              configurable: true,
              writable: false,
            })
          }
          return value
        },
        enumerable: true,
        configurable: true,
      })
    }

    // @Value — lazy environment variable injection
    for (const [prop, config] of plan.values) {
      Object.defineProperty(instance, prop, {
        get() {
          // The env resolver when one is set (a host's validated,
          // type-coerced config, say: PORT as a number).
          if (hooks.envResolver) {
            const val = hooks.envResolver(config.envKey)
            if (val !== undefined) return val
          }

          // Fallback to raw process.env for apps that haven't called loadEnv()
          const val = process.env[config.envKey]
          if (val !== undefined) return val
          if (config.defaultValue !== undefined) return config.defaultValue
          throw hooks.errorFactory('KICK004', config.envKey)
        },
        enumerable: true,
        configurable: true,
      })
    }

    // Host injectors — getters prepared at plan build.
    for (const [prop, get] of plan.injected) {
      Object.defineProperty(instance, prop, { get, enumerable: true, configurable: true })
    }
  }
}
