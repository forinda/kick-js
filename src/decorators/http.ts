import 'reflect-metadata';
import type { RequestHandler } from 'express';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface ControllerOptions {
  path?: string;
  autoRegister?: boolean;
  tags?: string[];
}

export interface ControllerMetadata {
  basePath: string;
  tags?: string[];
}

export type SchemaLike = {
  safeParse?: (data: unknown) => { success: boolean; data?: unknown; error?: unknown };
  parse?: (data: unknown) => unknown;
  validate?: (
    data: unknown,
    options?: Record<string, unknown>
  ) => { error?: { details?: Array<{ message: string }> }; value: unknown };
};

export interface RouteValidation {
  params?: SchemaLike;
  query?: SchemaLike;
  body?: SchemaLike;
}

export interface RouteOptions {
  path?: string;
  middlewares?: RequestHandler[];
  validate?: RouteValidation;
}

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  propertyKey: string | symbol;
  middlewares: RequestHandler[];
  validation?: RouteValidation;
}

export type ControllerConstructor<T = unknown> = new (...args: never[]) => T;

const CONTROLLER_KEY = Symbol('core:controller');
const ROUTES_KEY = Symbol('core:routes');

const controllerRegistry = new Set<ControllerConstructor>();

export function Controller(pathOrOptions: string | ControllerOptions = '/') {
  const options = normalizeControllerOptions(pathOrOptions);

  return function <T extends ControllerConstructor>(target: T) {
    Reflect.defineMetadata(
      CONTROLLER_KEY,
      {
        basePath: options.path,
        tags: options.tags
      } satisfies ControllerMetadata,
      target
    );

    if (!Reflect.hasMetadata(ROUTES_KEY, target)) {
      Reflect.defineMetadata(ROUTES_KEY, [] as RouteDefinition[], target);
    }

    if (options.autoRegister !== false) {
      controllerRegistry.add(target);
    }
  };
}

export function Get(path?: string | RouteOptions, ...middlewares: RequestHandler[]) {
  return createRouteDecorator('get')(path, ...middlewares);
}

export function Post(path?: string | RouteOptions, ...middlewares: RequestHandler[]) {
  return createRouteDecorator('post')(path, ...middlewares);
}

export function Put(path?: string | RouteOptions, ...middlewares: RequestHandler[]) {
  return createRouteDecorator('put')(path, ...middlewares);
}

export function Patch(path?: string | RouteOptions, ...middlewares: RequestHandler[]) {
  return createRouteDecorator('patch')(path, ...middlewares);
}

export function Delete(path?: string | RouteOptions, ...middlewares: RequestHandler[]) {
  return createRouteDecorator('delete')(path, ...middlewares);
}

export function listRegisteredControllers(): ControllerConstructor[] {
  return Array.from(controllerRegistry);
}

export function registerController(controller: ControllerConstructor) {
  controllerRegistry.add(controller);
}

export function resetControllerRegistry() {
  controllerRegistry.clear();
}

export const DecoratorMetadata = {
  CONTROLLER_KEY,
  ROUTES_KEY
} as const;

function createRouteDecorator(method: HttpMethod) {
  return (pathOrOptions?: string | RouteOptions, ...middlewares: RequestHandler[]) =>
    function (target: object, propertyKey: string | symbol) {
      const controller = target.constructor;
      const routes: RouteDefinition[] = Reflect.getMetadata(ROUTES_KEY, controller) ?? [];
      const normalized = normalizeRouteOptions(pathOrOptions, middlewares);
      routes.push({
        method,
        path: normalized.path,
        propertyKey,
        middlewares: normalized.middlewares,
        validation: normalized.validation
      });
      Reflect.defineMetadata(ROUTES_KEY, routes, controller);
    };
}

function normalizeControllerOptions(pathOrOptions: string | ControllerOptions): Required<ControllerOptions> {
  if (typeof pathOrOptions === 'string') {
    return {
      path: normalizePath(pathOrOptions),
      autoRegister: true,
      tags: []
    };
  }

  return {
    path: normalizePath(pathOrOptions.path ?? '/'),
    autoRegister: pathOrOptions.autoRegister ?? true,
    tags: pathOrOptions.tags ?? []
  };
}

function normalizeRouteOptions(pathOrOptions: string | RouteOptions | undefined, extraMiddlewares: RequestHandler[]) {
  const base: RouteOptions = normalizeRouteOptionObject(pathOrOptions);
  const middlewares = [...(base.middlewares ?? []), ...extraMiddlewares];

  return {
    path: normalizeRoutePath(base.path ?? '/'),
    middlewares,
    validation: base.validate
  };
}

function normalizeRouteOptionObject(pathOrOptions: string | RouteOptions | undefined): RouteOptions {
  if (typeof pathOrOptions === 'string') {
    return { path: pathOrOptions };
  }

  if (typeof pathOrOptions === 'object' && pathOrOptions !== null) {
    return { ...pathOrOptions };
  }

  return {};
}

function normalizePath(path: string) {
  if (!path || path === '/') {
    return '/';
  }

  const withLeading = path.startsWith('/') ? path : `/${path}`;
  return withLeading.endsWith('/') && withLeading !== '/' ? withLeading.slice(0, -1) : withLeading;
}

function normalizeRoutePath(path: string) {
  if (!path || path === '/') {
    return '';
  }

  const cleaned = path.startsWith('/') ? path.slice(1) : path;
  return cleaned.endsWith('/') ? cleaned.slice(0, -1) : cleaned;
}
