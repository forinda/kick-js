import 'reflect-metadata'

/** Lifecycle scope for DI registrations */
export enum Scope {
  SINGLETON = 'singleton',
  TRANSIENT = 'transient',
  /** One instance per HTTP request, cached in AsyncLocalStorage. Throws outside request context. */
  REQUEST = 'request',
}

/** Generic constructor type */
export type Constructor<T = any> = new (...args: any[]) => T

/** A value that may or may not be wrapped in a Promise */
export type MaybePromise<T = void> = T | Promise<T>

/** Options for @Service, @Repository, @Component decorators */
export interface ServiceOptions {
  scope?: Scope
}

/** Fluent builder type */
export type BuilderOf<T> = {
  [K in keyof T as T[K] extends Function ? never : K]-?: (value: T[K]) => BuilderOf<T>
} & { build(): T }

/** Class with static builder() method */
export interface Buildable<T> {
  builder(): BuilderOf<T>
}

/** Decorator class kind for devtools introspection */
export type ClassKind =
  | 'service'
  | 'controller'
  | 'repository'
  | 'component'
  | 'injectable'
  | 'factory'
  | 'instance'
  | 'unknown'

/** PostConstruct lifecycle status */
export type PostConstructStatus = 'pending' | 'completed' | 'failed' | 'skipped'

/**
 * String metadata keys for the DI system + decorator subsystem. Every
 * key starts with the `kick:` prefix; the suffix is a short identifier
 * that may itself contain `:`, `-`, or `_` separators (historical —
 * keys grew alongside the framework). The §22 v4 convention is "no
 * Symbols", not "use a strict naming scheme" — Symbols don't survive
 * JSON serialisation, can't be addressed by string from worker
 * threads, and don't show up in DevTools snapshots.
 *
 * `reflect-metadata` accepts both Symbol and string keys identically,
 * so the consumer-side change is internal — references go through the
 * `METADATA` enum's named members (e.g. `METADATA.INJECT`), not the
 * underlying string.
 *
 * The `design:*` entries match what TypeScript's
 * `emitDecoratorMetadata` writes; those names are fixed by the
 * compiler + must stay as-is.
 */
export const METADATA = {
  INJECTABLE: 'kick:injectable',
  SCOPE: 'kick:scope',
  CLASS_KIND: 'kick:class-kind',
  AUTOWIRED: 'kick:autowired',
  INJECT: 'kick:inject',
  POST_CONSTRUCT: 'kick:post_construct',
  BUILDER: 'kick:builder',
  QUERY_PARAMS: 'kick:query:params',
  CONTROLLER_PATH: 'kick:controller:path',
  ROUTES: 'kick:routes',
  CLASS_MIDDLEWARES: 'kick:class:middlewares',
  METHOD_MIDDLEWARES: 'kick:method:middlewares',
  CLASS_CONTRIBUTORS: 'kick:class:contributors',
  METHOD_CONTRIBUTORS: 'kick:method:contributors',
  FILE_UPLOAD: 'kick:file:upload',
  VALUE: 'kick:value',
  ASSET: 'kick:asset',
  // TypeScript emit metadata keys — fixed by the compiler.
  PARAM_TYPES: 'design:paramtypes',
  PROPERTY_TYPE: 'design:type',
  RETURN_TYPE: 'design:returntype',
} as const
