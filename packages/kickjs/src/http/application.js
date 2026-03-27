import http from 'node:http';
import express from 'express';
import { Container, createLogger, normalizePath, METADATA, } from '../core';
import { requestId } from './middleware/request-id';
import { notFoundHandler, errorHandler } from './middleware/error-handler';
const log = createLogger('Application');
/**
 * The main application class. Wires together Express, the DI container,
 * feature modules, adapters, and the middleware pipeline.
 */
export class Application {
    options;
    app;
    container;
    httpServer = null;
    adapters;
    plugins;
    constructor(options) {
        this.options = options;
        this.app = express();
        this.container = Container.getInstance();
        this.plugins = options.plugins ?? [];
        this.adapters = [
            // Plugin adapters first
            ...this.plugins.flatMap((p) => p.adapters?.() ?? []),
            ...(options.adapters ?? []),
        ];
    }
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
    adapterCtx(server) {
        const env = process.env.NODE_ENV ?? 'development';
        return {
            app: this.app,
            container: this.container,
            server,
            env,
            isProduction: env === 'production',
        };
    }
    /** Call an adapter hook, catching sync errors and async rejections */
    callHook(hook, ctx) {
        if (!hook)
            return;
        try {
            const result = hook(ctx);
            // Catch async rejections from Promise-returning hooks
            if (result && typeof result.catch === 'function') {
                result.catch((err) => log.error(err, 'Adapter async hook failed'));
            }
        }
        catch (err) {
            log.error(err, 'Adapter hook failed');
        }
    }
    setup() {
        log.info('Bootstrapping application...');
        // Collect adapter middleware by phase
        const adapterMw = this.collectAdapterMiddleware();
        this.app.__kickApp = this;
        const ctx = this.adapterCtx();
        // ── 1. Adapter beforeMount hooks ──────────────────────────────────
        for (const adapter of this.adapters) {
            this.callHook(adapter.beforeMount?.bind(adapter), ctx);
        }
        // ── 2. Hardened defaults ──────────────────────────────────────────
        this.app.disable('x-powered-by');
        this.app.set('trust proxy', this.options.trustProxy ?? false);
        // ── 3. Adapter middleware: beforeGlobal ───────────────────────────
        this.mountMiddlewareList(adapterMw.beforeGlobal);
        // ── 3b. Plugin registration ──────────────────────────────────────
        for (const plugin of this.plugins) {
            plugin.register?.(this.container);
        }
        // ── 3c. Plugin middleware ─────────────────────────────────────────
        for (const plugin of this.plugins) {
            const mw = plugin.middleware?.() ?? [];
            for (const handler of mw) {
                this.app.use(handler);
            }
        }
        // ── 4. Global middleware ─────────────────────────────────────────
        if (this.options.middleware) {
            // User-declared pipeline — full control
            for (const entry of this.options.middleware) {
                this.mountMiddlewareEntry(entry);
            }
        }
        else {
            // Sensible defaults when no middleware declared
            this.app.use(requestId());
            this.app.use(express.json({ limit: this.options.jsonLimit ?? '100kb' }));
        }
        // ── 5. Adapter middleware: afterGlobal ────────────────────────────
        this.mountMiddlewareList(adapterMw.afterGlobal);
        // ── 6. Module registration + DI bootstrap ────────────────────────
        // Plugin modules first, then user modules
        const allModuleClasses = [
            ...this.plugins.flatMap((p) => p.modules?.() ?? []),
            ...this.options.modules,
        ];
        const modules = allModuleClasses.map((ModuleClass) => {
            const mod = new ModuleClass();
            mod.register(this.container);
            return mod;
        });
        this.container.bootstrap();
        // ── 7. Adapter middleware: beforeRoutes ───────────────────────────
        this.mountMiddlewareList(adapterMw.beforeRoutes);
        // ── 8. Mount module routes with versioning ───────────────────────
        const apiPrefix = this.options.apiPrefix ?? '/api';
        const defaultVersion = this.options.defaultVersion ?? 1;
        const shouldLogRoutes = this.options.logRoutesTable ?? process.env.NODE_ENV !== 'production';
        // Collect route metadata during mounting (avoids calling mod.routes() twice)
        const mountedRoutes = [];
        for (const mod of modules) {
            const result = mod.routes();
            if (!result)
                continue; // Non-HTTP modules (queues, cron) may return null
            const routeSets = Array.isArray(result) ? result : [result];
            for (const route of routeSets) {
                const version = route.version ?? defaultVersion;
                const mountPath = `${apiPrefix}/v${version}${normalizePath(route.path)}`;
                this.app.use(mountPath, route.router);
                // Notify adapters (e.g. SwaggerAdapter for OpenAPI spec generation)
                if (route.controller) {
                    for (const adapter of this.adapters) {
                        adapter.onRouteMount?.(route.controller, mountPath);
                    }
                    if (shouldLogRoutes) {
                        mountedRoutes.push({ controller: route.controller, mountPath });
                    }
                }
            }
        }
        // ── 8b. Log route summary ─────────────────────────────────────────
        if (shouldLogRoutes && mountedRoutes.length > 0) {
            const methodOrder = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
            const methodRank = (m) => {
                const i = methodOrder.indexOf(m);
                return i === -1 ? 99 : i;
            };
            let totalRoutes = 0;
            log.info('Routes:');
            for (const { controller, mountPath } of mountedRoutes) {
                const defs = Reflect.getMetadata(METADATA.ROUTES, controller) || [];
                if (defs.length === 0)
                    continue;
                const counts = {};
                for (const def of defs) {
                    const m = def.method.toUpperCase();
                    counts[m] = (counts[m] || 0) + 1;
                }
                totalRoutes += defs.length;
                const methods = Object.entries(counts)
                    .sort(([a], [b]) => methodRank(a) - methodRank(b))
                    .map(([m, n]) => `${n} ${m}`)
                    .join(', ');
                const name = controller.name || 'Controller';
                log.info(`  ${name.padEnd(30)} ${mountPath.padEnd(25)} ${defs.length} routes (${methods})`);
            }
            log.info(`  Total: ${totalRoutes} routes`);
        }
        // ── 9. Adapter middleware: afterRoutes ────────────────────────────
        this.mountMiddlewareList(adapterMw.afterRoutes);
        // ── 10. Error handlers ───────────────────────────────────────────
        this.app.use(notFoundHandler());
        this.app.use(errorHandler());
        // ── 11. Adapter beforeStart hooks ────────────────────────────────
        for (const adapter of this.adapters) {
            this.callHook(adapter.beforeStart?.bind(adapter), ctx);
        }
    }
    /** Register modules and DI without starting the HTTP server (used by kick tinker) */
    registerOnly() {
        this.setup();
    }
    /** Start the HTTP server — fails fast if port is in use */
    start() {
        this.setup();
        const port = this.options.port ?? parseInt(process.env.PORT || '3000', 10);
        this.httpServer = http.createServer(this.app);
        this.httpServer.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                log.error(`Port ${port} is already in use. Kill the existing process or use a different port:\n` +
                    `  PORT=${port + 1} kick dev\n` +
                    `  lsof -i :${port}   # find what's using it\n` +
                    `  kill <PID>          # stop it`);
                process.exit(1);
            }
            throw err;
        });
        this.httpServer.listen(port, async () => {
            log.info(`Server running on http://localhost:${port}`);
            for (const adapter of this.adapters) {
                const afterCtx = this.adapterCtx(this.httpServer);
                this.callHook(adapter.afterStart?.bind(adapter), afterCtx);
            }
            // Plugin onReady hooks
            for (const plugin of this.plugins) {
                await plugin.onReady?.(this.container);
            }
        });
    }
    /** HMR rebuild: swap Express handler without restarting the server */
    rebuild() {
        // Reset the DI container so singletons are re-created with fresh code
        Container.reset();
        this.container = Container.getInstance();
        this.app = express();
        this.setup();
        if (this.httpServer) {
            this.httpServer.removeAllListeners('request');
            this.httpServer.on('request', this.app);
            log.info('HMR: Express app rebuilt and swapped');
        }
    }
    /** Graceful shutdown — runs all adapter shutdowns in parallel, resilient to failures */
    async shutdown() {
        log.info('Shutting down...');
        // Run all plugin + adapter shutdowns concurrently
        const results = await Promise.allSettled([
            ...this.plugins.map((plugin) => Promise.resolve(plugin.shutdown?.())),
            ...this.adapters.map((adapter) => Promise.resolve(adapter.shutdown?.())),
        ]);
        for (const result of results) {
            if (result.status === 'rejected') {
                log.error({ err: result.reason }, 'Adapter shutdown failed');
            }
        }
        if (this.httpServer) {
            await new Promise((resolve) => this.httpServer.close(() => resolve()));
        }
    }
    getExpressApp() {
        return this.app;
    }
    /** Get registered adapters — used by DevToolsAdapter for peer discovery */
    getAdapters() {
        return this.adapters;
    }
    getHttpServer() {
        return this.httpServer;
    }
    // ── Internal helpers ────────────────────────────────────────────────
    collectAdapterMiddleware() {
        const result = {
            beforeGlobal: [],
            afterGlobal: [],
            beforeRoutes: [],
            afterRoutes: [],
        };
        for (const adapter of this.adapters) {
            const entries = adapter.middleware?.() ?? [];
            for (const entry of entries) {
                const phase = entry.phase ?? 'afterGlobal';
                result[phase].push(entry);
            }
        }
        return result;
    }
    mountMiddlewareList(entries) {
        for (const entry of entries) {
            if (entry.path) {
                this.app.use(entry.path, entry.handler);
            }
            else {
                this.app.use(entry.handler);
            }
        }
    }
    mountMiddlewareEntry(entry) {
        if (typeof entry === 'function') {
            this.app.use(entry);
        }
        else {
            this.app.use(entry.path, entry.handler);
        }
    }
}
//# sourceMappingURL=application.js.map