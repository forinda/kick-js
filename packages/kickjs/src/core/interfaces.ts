import 'reflect-metadata'
import { DI_METADATA } from './di/interfaces'

export {
  Scope,
  DI_METADATA,
  type Constructor,
  type ServiceOptions,
  type BuilderOf,
  type Buildable,
  type ClassKind,
  type PostConstructStatus,
} from './di/interfaces'

/** A value that may or may not be wrapped in a Promise */
export type MaybePromise<T = void> = T | Promise<T>

/** Metadata keys: the DI ones (`DI_METADATA`) plus the HTTP layer's and `@Asset`'s. */
export const METADATA = {
  ...DI_METADATA,
  QUERY_PARAMS: 'kick:query:params',
  ROUTES: 'kick:routes',
  CLASS_MIDDLEWARES: 'kick:class:middlewares',
  METHOD_MIDDLEWARES: 'kick:method:middlewares',
  CLASS_CONTRIBUTORS: 'kick:class:contributors',
  METHOD_CONTRIBUTORS: 'kick:method:contributors',
  CLASS_FLAGS: 'kick:class:flags',
  METHOD_FLAGS: 'kick:method:flags',
  FILE_UPLOAD: 'kick:file:upload',
  ASSET: 'kick:asset',
} as const
