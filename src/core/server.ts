import { createHash } from 'node:crypto';
import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import { Container } from 'inversify';
import 'reflect-metadata';
import {
  DecoratorMetadata,
  type RouteDefinition,
  type ControllerConstructor,
  listRegisteredControllers,
  RouteValidation,
  SchemaLike
} from '../decorators/http';
import { Injectable } from '../utils/injection';
import { createError } from '../utils/errors';
import { TYPES } from '../shared/types';
import { RequestTracker } from './request-tracker';

export interface ServerOptions {
  controllers?: ControllerConstructor[];
  prefix?: string;
}

const appRouteRegistry = new WeakMap<Application, Set<string>>();

export function registerControllers(app: Application, container: Container, options: ServerOptions = {}) {
  const controllers = options.controllers ?? listRegisteredControllers();
  const prefix = options.prefix ?? '';
  const requestTracker = container.get<RequestTracker>(TYPES.RequestTracker);

  controllers.forEach((ControllerClass) => {
    ensureInjectable(ControllerClass);
    const controllerMetadata = Reflect.getMetadata(DecoratorMetadata.CONTROLLER_KEY, ControllerClass);
    if (!controllerMetadata) {
      return;
    }

    if (!container.isBound(ControllerClass)) {
      container.bind(ControllerClass).toSelf().inSingletonScope();
    }

    const instance = container.get<unknown>(ControllerClass) as Record<string | symbol, unknown>;
    const routes: RouteDefinition[] = Reflect.getMetadata(DecoratorMetadata.ROUTES_KEY, ControllerClass) ?? [];

    routes.forEach((route) => {
      const handler = instance[route.propertyKey];

      if (typeof handler !== 'function') {
        throw new Error(`Route handler ${String(route.propertyKey)} on ${ControllerClass.name} is not a function`);
      }

      const fullPath = buildRoutePath(prefix, controllerMetadata.basePath, route.path);
      const routeHash = registerRouteSignature(app, route.method, fullPath, ControllerClass.name, route.propertyKey);

      const boundHandler = (handler as (...args: unknown[]) => unknown).bind(instance);
      const validationMiddleware = buildValidationMiddleware(route.validation);
      const routeMetadataMiddleware: RequestHandler = (_req, res, next) => {
        requestTracker.mergeMetadata(res, {
          route: fullPath,
          method: route.method.toUpperCase(),
          routeHash
        });
        next();
      };

      const pipeline: RequestHandler[] = [routeMetadataMiddleware, ...validationMiddleware, ...route.middlewares];

      app[route.method](fullPath, ...pipeline, async (req: Request, res: Response, next: NextFunction) => {
        try {
          const result = await Promise.resolve(boundHandler(req, res, next));
          if (result !== undefined && !res.headersSent) {
            res.json(result);
          }
        } catch (error) {
          next(error);
        }
      });
    });
  });
}

function ensureInjectable(constructor: ControllerConstructor) {
  if (!Reflect.hasOwnMetadata('inversify:paramtypes', constructor)) {
    Injectable()(constructor as never);
  }
}

function buildRoutePath(prefix: string, basePath: string, routePath: string) {
  const segments = [...toSegments(prefix), ...toSegments(basePath), ...toSegments(routePath)];
  if (segments.length === 0) {
    return '/';
  }
  return `/${segments.join('/')}`;
}

function toSegments(segment: string | undefined) {
  if (!segment || segment === '/') {
    return [];
  }

  const trimmed = segment.replace(/^\/+|\/+$/g, '');
  return trimmed ? [trimmed] : [];
}

function registerRouteSignature(
  app: Application,
  method: string,
  path: string,
  controllerName: string,
  propertyKey: string | symbol
) {
  let registry = appRouteRegistry.get(app);
  if (!registry) {
    registry = new Set<string>();
    appRouteRegistry.set(app, registry);
  }

  const normalized = `${method.toLowerCase()}:${path.toLowerCase()}`;
  const hash = createHash('sha256').update(normalized).digest('hex');

  if (registry.has(hash)) {
    throw createError('ROUTE_CONFLICT', `Duplicate route detected for [${method.toUpperCase()}] ${path}`, {
      details: {
        controller: controllerName,
        handler: String(propertyKey)
      }
    });
  }

  registry.add(hash);
  return hash;
}

function buildValidationMiddleware(validation?: RouteValidation): RequestHandler[] {
  if (!validation) {
    return [];
  }

  const middleware: RequestHandler = (req, _res, next) => {
    try {
      if (validation.params) {
        req.params = runSchema(validation.params, req.params, 'params');
      }
      if (validation.query) {
        req.query = runSchema(validation.query, req.query, 'query');
      }
      if (validation.body) {
        req.body = runSchema(validation.body, req.body, 'body');
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  return [middleware];
}

function runSchema(schema: SchemaLike, value: unknown, target: 'params' | 'query' | 'body') {
  if (isZodSchema(schema)) {
    if (typeof schema.safeParse === 'function') {
      const result = schema.safeParse(value);
      if (!result.success) {
        const issues = Array.isArray((result.error as { issues?: Array<{ message: string }> })?.issues)
          ? (result.error as { issues: Array<{ message: string }> }).issues.map((issue) => issue.message)
          : [(result.error as { message?: string }).message].filter(Boolean);
        throw validationError(target, issues);
      }
      return result.data;
    }

    try {
      return schema.parse(value);
    } catch (error) {
      const issues = extractErrorMessages(error);
      throw validationError(target, issues);
    }
  }

  if (isJoiSchema(schema)) {
    const { error, value: validated } = schema.validate(value, { abortEarly: false, stripUnknown: true });
    if (error) {
      throw validationError(
        target,
        error.details?.map((detail: { message: string }) => detail.message)
      );
    }
    return validated;
  }

  throw createError('VALIDATION_UNSUPPORTED', 'Unsupported validation schema provided', {
    details: { target }
  });
}

function isZodSchema(schema: SchemaLike): schema is { safeParse?: (value: unknown) => { success: boolean; data: unknown; error?: any }; parse: (value: unknown) => unknown } {
  if (typeof schema !== 'object' || schema === null) {
    return false;
  }
  return typeof (schema as { safeParse?: unknown }).safeParse === 'function' || typeof (schema as { parse?: unknown }).parse === 'function';
}

function isJoiSchema(schema: SchemaLike): schema is { validate: (value: unknown, options?: unknown) => { error?: any; value: any } } {
  if (typeof schema !== 'object' || schema === null) {
    return false;
  }
  return typeof (schema as { validate?: unknown }).validate === 'function';
}

function validationError(target: string, issues?: Array<string | undefined>) {
  return createError('VALIDATION_ERROR', `Invalid ${target}`, {
    status: 400,
    details: {
      target,
      issues: issues?.filter((issue): issue is string => Boolean(issue))
    }
  });
}

function extractErrorMessages(error: unknown) {
  if (!error) {
    return [] as string[];
  }

  if (Array.isArray((error as { issues?: Array<{ message: string }> }).issues)) {
    return (error as { issues: Array<{ message: string }> }).issues.map((issue) => issue.message);
  }

  if (error instanceof Error && error.message) {
    return [error.message];
  }

  return [String(error)];
}
