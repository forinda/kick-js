import 'reflect-metadata'
/** Lifecycle scope for DI registrations */
export declare enum Scope {
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
} & {
  build(): T
}
/** Class with static builder() method */
export interface Buildable<T> {
  builder(): BuilderOf<T>
}
/** Symbol-based metadata keys for the DI system */
export declare const METADATA: {
  readonly INJECTABLE: symbol
  readonly SCOPE: symbol
  readonly AUTOWIRED: symbol
  readonly INJECT: symbol
  readonly POST_CONSTRUCT: symbol
  readonly BUILDER: symbol
  readonly QUERY_PARAMS: symbol
  readonly CONTROLLER_PATH: symbol
  readonly ROUTES: symbol
  readonly CLASS_MIDDLEWARES: symbol
  readonly METHOD_MIDDLEWARES: symbol
  readonly FILE_UPLOAD: symbol
  readonly VALUE: symbol
  readonly PARAM_TYPES: 'design:paramtypes'
  readonly PROPERTY_TYPE: 'design:type'
  readonly RETURN_TYPE: 'design:returntype'
}
//# sourceMappingURL=interfaces.d.ts.map
