import './instance-guard'

export {
  Container,
  tokenName,
  type ContainerChangeEvent,
  type ContainerChangeListener,
  type KickJsRegistry,
  type EnvResolver,
  type ErrorFactory,
  type PropertyInjector,
  type RequestStore,
  type RequestStoreProvider,
} from './container'
export {
  registerInjectable,
  Injectable,
  Service,
  Component,
  Repository,
  PostConstruct,
  PreDestroy,
  Autowired,
  Inject,
  Value,
  Builder,
  withBuilder,
  type PropertyOrParameterDecorator,
  type EnvKey,
  type Env,
} from './decorators'
export {
  registerDisposable,
  drainDisposables,
  runDisposables,
  disposeAll,
  type Disposable,
} from './disposables'
export { DiError, diError, defaultLogger, type DiErrorCode, type DiLogger } from './errors'
export {
  Scope,
  DI_METADATA,
  type Constructor,
  type AbstractConstructor,
  type ClassWithPrototype,
  type NotCallable,
  type ServiceOptions,
  type BuilderOf,
  type Buildable,
  type ClassKind,
  type PostConstructStatus,
} from './interfaces'
export {
  setClassMeta,
  setMethodMeta,
  getClassMeta,
  getMethodMeta,
  hasClassMeta,
  getClassMetaOrUndefined,
  getMethodMetaOrUndefined,
  pushClassMeta,
  pushMethodMeta,
  setInMetaMap,
  getMetaMap,
  setInMetaRecord,
  getMetaRecord,
} from './metadata'
export { INJECTION_TOKEN, createToken, ctn, isInjectionToken, type InjectionToken } from './token'
