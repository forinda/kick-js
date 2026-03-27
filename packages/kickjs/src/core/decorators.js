import 'reflect-metadata';
import { METADATA, Scope } from './interfaces';
import { Container } from './container';
const pendingRegistrations = [];
const allRegistrations = new Map();
let containerRef = null;
function flushPending(container) {
    containerRef = container;
    for (const { target, scope } of pendingRegistrations) {
        if (!container.has(target)) {
            container.register(target, target, scope);
        }
    }
    pendingRegistrations.length = 0;
}
// Wire up synchronously — Container._onReady is called on first getInstance()
Container._onReady = flushPending;
// On Container.reset(), update containerRef and replay ALL decorator
// registrations on the fresh container. This handles HMR where the container
// is wiped but not all decorated modules are re-evaluated.
Container._onReset = (container) => {
    containerRef = container;
    for (const [target, scope] of allRegistrations) {
        if (!container.has(target)) {
            container.register(target, target, scope);
        }
    }
};
// ── Class Decorators ────────────────────────────────────────────────────
function registerInContainer(target, scope) {
    Reflect.defineMetadata(METADATA.INJECTABLE, true, target);
    Reflect.defineMetadata(METADATA.SCOPE, scope, target);
    // Track in persistent registry — survives Container.reset() for HMR replay
    allRegistrations.set(target, scope);
    if (containerRef) {
        // Container already initialized — register immediately
        if (!containerRef.has(target)) {
            containerRef.register(target, target, scope);
        }
    }
    else {
        // Container not ready yet — queue for later
        pendingRegistrations.push({ target, scope });
    }
}
/** Mark a class as injectable with lifecycle scope */
export function Injectable(options) {
    return (target) => {
        registerInContainer(target, options?.scope ?? Scope.SINGLETON);
    };
}
/** Mark a class as a service (semantic alias for Injectable) */
export function Service(options) {
    return (target) => {
        registerInContainer(target, options?.scope ?? Scope.SINGLETON);
    };
}
/** Mark a class as a generic managed component */
export function Component(options) {
    return (target) => {
        registerInContainer(target, options?.scope ?? Scope.SINGLETON);
    };
}
/** Mark a class as a repository */
export function Repository(options) {
    return (target) => {
        registerInContainer(target, options?.scope ?? Scope.SINGLETON);
    };
}
/**
 * Mark a class as an HTTP controller and register it in the DI container.
 *
 * @param path - **Deprecated.** The path parameter is no longer used for routing.
 *   Route prefixes are defined by the module's `routes().path` — the single source
 *   of truth for where routes are mounted. This parameter will be removed in a
 *   future major version.
 */
export function Controller(path) {
    return (target) => {
        registerInContainer(target, Scope.SINGLETON);
        Reflect.defineMetadata(METADATA.CONTROLLER_PATH, path || '/', target);
    };
}
// ── Method Decorators ───────────────────────────────────────────────────
/** Mark a method as a lifecycle hook called after instantiation */
export function PostConstruct() {
    return (target, propertyKey) => {
        Reflect.defineMetadata(METADATA.POST_CONSTRUCT, propertyKey, target);
    };
}
// ── Property Decorators ─────────────────────────────────────────────────
/** Property injection — resolved lazily from the container */
export function Autowired(token) {
    return (target, propertyKey) => {
        const existing = Reflect.getMetadata(METADATA.AUTOWIRED, target) || new Map();
        existing.set(propertyKey, token);
        Reflect.defineMetadata(METADATA.AUTOWIRED, existing, target);
    };
}
/**
 * Constructor parameter injection with an explicit token.
 *
 * **Constructor parameters only** — does not work as a property decorator.
 * For property injection with a token, use `@Autowired(token)` instead.
 */
export function Inject(token) {
    return (target, _propertyKey, parameterIndex) => {
        const existing = Reflect.getMetadata(METADATA.INJECT, target) || {};
        existing[parameterIndex] = token;
        Reflect.defineMetadata(METADATA.INJECT, existing, target);
    };
}
/**
 * Inject an environment variable value. Evaluated lazily so the env
 * is available at access time, not at decoration time.
 *
 * If no default is provided and the env var is missing, throws at access time
 * to catch misconfiguration early instead of returning undefined.
 *
 * Uses metadata + instance getter to work correctly with `useDefineForClassFields`.
 */
export function Value(envKey, defaultValue) {
    return (target, propertyKey) => {
        const existing = Reflect.getMetadata(METADATA.VALUE, target) || new Map();
        existing.set(propertyKey, { envKey, defaultValue });
        Reflect.defineMetadata(METADATA.VALUE, existing, target);
    };
}
function createRouteDecorator(method) {
    return (path, validation) => {
        return (target, propertyKey) => {
            const routes = Reflect.getMetadata(METADATA.ROUTES, target.constructor) || [];
            routes.push({
                method,
                path: path || '/',
                handlerName: propertyKey,
                validation,
            });
            Reflect.defineMetadata(METADATA.ROUTES, routes, target.constructor);
        };
    };
}
export const Get = createRouteDecorator('GET');
export const Post = createRouteDecorator('POST');
export const Put = createRouteDecorator('PUT');
export const Delete = createRouteDecorator('DELETE');
export const Patch = createRouteDecorator('PATCH');
/**
 * Normalize a query params config to the string-based ApiQueryParamsConfig.
 * Handles both string-based and column-object-based configs.
 */
export function normalizeApiQueryParamsConfig(config) {
    if ('columns' in config && config.columns && typeof config.columns === 'object') {
        return {
            filterable: Object.keys(config.columns),
            sortable: config.sortable ? Object.keys(config.sortable) : undefined,
            searchable: config.searchColumns
                ? config.searchColumns.map((col) => col?.name ?? '').filter(Boolean)
                : undefined,
        };
    }
    return config;
}
/**
 * Document the query parameters accepted by a GET endpoint.
 * Used by SwaggerAdapter to generate `filter`, `sort`, `page`, `limit`, and `q` params
 * in the OpenAPI spec, with descriptions listing the allowed fields.
 *
 * Accepts both string-based configs and column-object configs (e.g., DrizzleQueryParamsConfig).
 *
 * @example
 * ```ts
 * // String-based
 * @ApiQueryParams({
 *   filterable: ['status', 'category', 'price'],
 *   sortable: ['name', 'createdAt', 'price'],
 *   searchable: ['name', 'description'],
 * })
 *
 * // Column-object-based (Drizzle)
 * @ApiQueryParams(TASK_QUERY_CONFIG)
 * ```
 */
export function ApiQueryParams(config) {
    return (target, propertyKey) => {
        const normalized = normalizeApiQueryParamsConfig(config);
        Reflect.defineMetadata(METADATA.QUERY_PARAMS, normalized, target.constructor, propertyKey);
    };
}
/** Attach middleware handlers to a class or method */
export function Middleware(...handlers) {
    return (target, propertyKey) => {
        if (propertyKey) {
            // Method-level middleware
            const existing = Reflect.getMetadata(METADATA.METHOD_MIDDLEWARES, target.constructor, propertyKey) || [];
            Reflect.defineMetadata(METADATA.METHOD_MIDDLEWARES, [...existing, ...handlers], target.constructor, propertyKey);
        }
        else {
            // Class-level middleware
            const existing = Reflect.getMetadata(METADATA.CLASS_MIDDLEWARES, target) || [];
            Reflect.defineMetadata(METADATA.CLASS_MIDDLEWARES, [...existing, ...handlers], target);
        }
    };
}
/** Configure file upload handling for a controller method */
export function FileUpload(config) {
    return (target, propertyKey) => {
        Reflect.defineMetadata(METADATA.FILE_UPLOAD, config, target.constructor, propertyKey);
    };
}
// ── Builder Decorator ───────────────────────────────────────────────────
/** Add a static builder() method for fluent construction */
export function Builder(target) {
    Reflect.defineMetadata(METADATA.BUILDER, true, target);
    target.builder = function () {
        const props = {};
        const proxy = new Proxy({}, {
            get(_, key) {
                if (key === 'build') {
                    return () => Object.assign(new target(), props);
                }
                return (value) => {
                    props[key] = value;
                    return proxy;
                };
            },
        });
        return proxy;
    };
}
//# sourceMappingURL=decorators.js.map