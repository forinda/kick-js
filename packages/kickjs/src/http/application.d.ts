import http from 'node:http';
import { type Express, type RequestHandler } from 'express';
import { type AppModuleClass, type AppAdapter, type KickPlugin } from '../core';
/**
 * A middleware entry in the declarative pipeline.
 * Can be a bare handler or an object with path scoping.
 */
export type MiddlewareEntry = RequestHandler | {
    path: string;
    handler: RequestHandler;
};
export interface ApplicationOptions {
    /** Feature modules to load */
    modules: AppModuleClass[];
    /** Adapters that hook into the lifecycle (DB, Redis, Swagger, etc.) */
    adapters?: AppAdapter[];
    /** Server port (falls back to PORT env var, then 3000) */
    port?: number;
    /** Global API prefix (default: '/api') */
    apiPrefix?: string;
    /** Default API version (default: 1) — routes become /{prefix}/v{version}/{path} */
    defaultVersion?: number;
    /**
     * Global middleware pipeline. Declared in order.
     * Replaces the hardcoded middleware stack — you control exactly what runs.
     *
     * @example
     * ```ts
     * bootstrap({
     *   modules,
     *   middleware: [
     *     helmet(),
     *     cors(),
     *     compression(),
     *     morgan('dev'),
     *     express.json({ limit: '1mb' }),
     *   ],
     * })
     * ```
     *
     * If omitted, a sensible default is applied:
     *   requestId(), express.json({ limit: '100kb' })
     */
    middleware?: MiddlewareEntry[];
    /** Plugins that bundle modules, adapters, middleware, and DI bindings */
    plugins?: KickPlugin[];
    /** Express `trust proxy` setting */
    trustProxy?: boolean | number | string | ((ip: string, hopIndex: number) => boolean);
    /** Maximum JSON body size (only used when middleware is not provided) */
    jsonLimit?: string | number;
    /**
     * Log route summary on startup. Default: true in dev, false in production.
     * Set to `true` to always log, `false` to always suppress.
     */
    logRoutesTable?: boolean;
}
/**
 * The main application class. Wires together Express, the DI container,
 * feature modules, adapters, and the middleware pipeline.
 */
export declare class Application {
    private readonly options;
    private app;
    private container;
    private httpServer;
    private adapters;
    private plugins;
    constructor(options: ApplicationOptions);
    /**
     * Full setup pipeline:
     * 1. Adapter beforeMount hooks (early routes — docs, health)
     * 2. Adapter middleware (phase: beforeGlobal)
     * 3. Global middleware (user-declared or defaults)
     * 4. Adapter middleware (phase: afterGlobal)
     * 5. Module registration + DI bootstrap
     * 6. Adapter middleware (phase: beforeRoutes)
     * 7. Module route mounting
     * 8. Adapter middleware (phase: afterRoutes)
     * 9. Error handlers (notFound + global)
     * 10. Adapter beforeStart hooks
     */
    /** Build the adapter context object (shared across all hooks) */
    private adapterCtx;
    /** Call an adapter hook, catching sync errors and async rejections */
    private callHook;
    setup(): void;
    /** Register modules and DI without starting the HTTP server (used by kick tinker) */
    registerOnly(): void;
    /** Start the HTTP server — fails fast if port is in use */
    start(): void;
    /** HMR rebuild: swap Express handler without restarting the server */
    rebuild(): void;
    /** Graceful shutdown — runs all adapter shutdowns in parallel, resilient to failures */
    shutdown(): Promise<void>;
    getExpressApp(): Express;
    /** Get registered adapters — used by DevToolsAdapter for peer discovery */
    getAdapters(): AppAdapter[];
    getHttpServer(): http.Server | null;
    private collectAdapterMiddleware;
    private mountMiddlewareList;
    private mountMiddlewareEntry;
}
//# sourceMappingURL=application.d.ts.map