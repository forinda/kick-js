import 'reflect-metadata'

/** Lifecycle scope for DI registrations */
export enum Scope {
  SINGLETON = 'singleton',
  TRANSIENT = 'transient',
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

/** Symbol-based metadata keys for the DI system */
export const METADATA = {
  INJECTABLE: Symbol('kick:injectable'),
  SCOPE: Symbol('kick:scope'),
  AUTOWIRED: Symbol('kick:autowired'),
  INJECT: Symbol('kick:inject'),
  POST_CONSTRUCT: Symbol('kick:post_construct'),
  BUILDER: Symbol('kick:builder'),
  QUERY_PARAMS: Symbol('kick:query:params'),
  CONTROLLER_PATH: Symbol('kick:controller:path'),
  ROUTES: Symbol('kick:routes'),
  CLASS_MIDDLEWARES: Symbol('kick:class:middlewares'),
  METHOD_MIDDLEWARES: Symbol('kick:method:middlewares'),
  FILE_UPLOAD: Symbol('kick:file:upload'),
  VALUE: Symbol('kick:value'),
  // TypeScript emit metadata keys
  PARAM_TYPES: 'design:paramtypes',
  PROPERTY_TYPE: 'design:type',
  RETURN_TYPE: 'design:returntype',
} as const
