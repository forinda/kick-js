import { createServer } from "http";
import { EventEmitter } from "events";
import { Container } from "inversify";
import { AutoBind } from "../decorators";
import { mapController } from "../utils/controller-mapper";
import { RouteMapper } from "../utils/route-mapper";
import { KICK_MODULE_KEYS, KICK_CONTROLLER_METADATA_KEYS } from "../constants/di-keys";

// Import types
import type { KickApplication } from "../types/application";
import type { KickApplicationContext } from "../types/application";
import type { KickAppMiddleware } from "../types/application";
import type { KickAppPlugin } from "../types/application";
import type { KickCreateModuleResultType, KickNextFn, KickRequest, KickResponse } from "../types";

@AutoBind
export class KickApp extends EventEmitter implements KickApplication {
    context: KickApplicationContext;
    name: string;
    public prefix: string;
    private container: Container;
    private _isInitialized = false;
    private _state: Record<string, any> = {};

    constructor(context: KickApplicationContext, name: string = "KickApp", prefix: string = "") {
        super();
        this.context = context;
        this.name = name;
        this.prefix = prefix;
        this.container = new Container({ autobind: true });
        
        // Emit creation event
        this.emit('created', { name: this.name, prefix: this.prefix });
    }

    public get isInitialized(): boolean {
        return this._isInitialized;
    }

    public get controllers(): any[] {
        try {
            return this.container.getAll<any>(KICK_MODULE_KEYS.KickControllerType);
        } catch {
            return [];
        }
    }

    public get state(): Readonly<Record<string, any>> {
        return { ...this._state };
    }

    public setState(key: string, value: any): void {
        const oldValue = this._state[key];
        this._state[key] = value;
        this.emit('state:changed', { key, value, oldValue });
        this.emit(`state:${key}`, { value, oldValue });
    }

    public getState(key: string): any {
        return this._state[key];
    }

    public onStateChange(key: string, listener: (data: { value: any; oldValue: any }) => void): void {
        this.on(`state:${key}`, listener);
    }

    public offStateChange(key: string, listener: (data: { value: any; oldValue: any }) => void): void {
        this.off(`state:${key}`, listener);
    }

    public loadPlugin(plugins: KickAppPlugin | KickAppPlugin[]) {
        if (!Array.isArray(plugins)) {
            plugins = [plugins];
        }
        plugins.forEach((plugin) => {
            plugin.install(this.context);
            this.emit('plugin:loaded', { plugin });
        });
        return this;
    }

    public registerMiddleware(
        middleware: KickAppMiddleware | KickAppMiddleware[]
    ) {
        if (!Array.isArray(middleware)) {
            middleware = [middleware];
        }

        // Sort middleware by priority if they have metadata
        const sortedMiddleware = middleware.sort((a, b) => {
            const metadataA = Reflect.getMetadata(KICK_CONTROLLER_METADATA_KEYS.middlewareOptions, a.constructor) || { priority: 0 };
            const metadataB = Reflect.getMetadata(KICK_CONTROLLER_METADATA_KEYS.middlewareOptions, b.constructor) || { priority: 0 };
            return metadataA.priority - metadataB.priority;
        });

        this.context.middlewares.push(...sortedMiddleware);

        // Log middleware registration with metadata
        sortedMiddleware.forEach(mw => {
            const metadata = Reflect.getMetadata(KICK_CONTROLLER_METADATA_KEYS.middlewareOptions, mw.constructor);
            if (metadata) {
                console.log(`[KickApp]: Registered middleware '${metadata.name}' (priority: ${metadata.priority}, source: ${metadata.global ? 'global' : 'DI'})`);
                this.emit('middleware:registered:detailed', { 
                    middleware: mw, 
                    metadata,
                    className: mw.constructor.name 
                });
            } else {
                // This is likely a global middleware without @KickMiddleware decorator
                console.log(`[KickApp]: Registered global middleware: ${mw.constructor.name}`);
            }
        });

        this.emit('middleware:registered', { count: sortedMiddleware.length });
        return this;
    }

    public mountMiddlewares() {
        console.log(
            `[KickApp]: Mounting ${this.context.middlewares.length} middlewares`
        );

        this.context.middlewares.forEach((middleware) => {
            this.context.app.use(middleware.use);
        });
        
        this.emit('middlewares:mounted', { count: this.context.middlewares.length });
        return this;
    }

    public loadModules(modules: KickCreateModuleResultType[]) {
        console.log(`[KickApp]: Loading ${modules.length} modules`);
        
        modules.forEach((module) => {
            console.log(`[MODULE]: loading ${module.name}`);
            module.install(this.container);
            this.emit('module:loaded', { module: module.name });
        });

        // Extract and register middlewares from DI container
        this.extractMiddlewaresFromContainer();

        // Map all controllers after modules are loaded
        this.mapControllers();
        this._isInitialized = true;
        
        this.setState('isInitialized', true);
        this.setState('modulesCount', modules.length);
        this.emit('initialized', this.getStats());
        
        return this;
    }

    private extractMiddlewaresFromContainer() {
        try {
            const middlewares = this.container.getAll<any>(KICK_MODULE_KEYS.KickMiddlewareType);
            console.log(`[KickApp]: Found ${middlewares.length} middlewares in DI container`);
            
            if (middlewares.length > 0) {
                this.registerMiddleware(middlewares);
            }
        } catch {
            console.warn('[KickApp]: No middlewares found in DI container');
        }
    }

    private mapControllers() {
        try {
            const controllers = this.container.getAll<any>(KICK_MODULE_KEYS.KickControllerType);
            console.log(`[KickApp]: Mapping ${controllers.length} controllers with prefix: "${this.prefix}"`);
            
            let routeCount = 0;
            controllers.forEach(controller => {
                const routes = mapController(controller);
                const mappedRoutes = RouteMapper.mapControllerRoutes(controller, routes, this.prefix);
                
                mappedRoutes.forEach(mappedRoute => {
                    const expressMethod = mappedRoute.method.toLowerCase() as keyof typeof this.context.app;
                    
                    if (typeof this.context.app[expressMethod] === 'function') {
                        // Log route registration with prefix info
                        RouteMapper.logRouteRegistration(
                            mappedRoute.method,
                            mappedRoute.fullPath,
                            mappedRoute.handlerName,
                            mappedRoute.controllerName,
                            this.prefix || undefined
                        );
                        
                        // Register the route with Express using the full path
                        (this.context.app[expressMethod] as any)(mappedRoute.fullPath, mappedRoute.handler);
                        
                        // Store route metadata with full path
                        this.context.requestHandlers[`${mappedRoute.method}:${mappedRoute.fullPath}`] = {
                            ...mappedRoute,
                            path: mappedRoute.fullPath
                        };
                        
                        // Emit route registration event
                        this.emit('route:registered', { 
                            method: mappedRoute.method, 
                            path: mappedRoute.fullPath, 
                            handler: mappedRoute.handlerName,
                            controller: mappedRoute.controllerName,
                            prefix: this.prefix
                        });
                        
                        routeCount++;
                    }
                });
                
                this.emit('controller:mapped', { 
                    controller: controller.constructor.name, 
                    routeCount: mappedRoutes.length,
                    prefix: this.prefix
                });
            });
            
            this.setState('controllersCount', controllers.length);
            this.setState('routesCount', routeCount);
            this.setState('routePrefix', this.prefix);
            
        } catch (error) {
            console.warn('[KickApp]: No controllers found to map', error);
            this.emit('error', { type: 'controller-mapping', error });
        }
    }

    public getContainer(): Container {
        return this.container;
    }

    public getStats() {
        return {
            name: this.name,
            isInitialized: this._isInitialized,
            controllersCount: this.controllers.length,
            middlewaresCount: this.context.middlewares.length,
            routes: Object.keys(this.context.requestHandlers),
            routesCount: Object.keys(this.context.requestHandlers).length,
            state: this.state
        };
    }

    public addErrorHandler(handler: (error: Error, context?: any) => void): void {
        this.on('error', handler);
    }

    public handleError(error: Error, context?: any): void {
        console.error(`[KickApp:${this.name}] Error:`, error.message);
        this.emit('error', { error, context, timestamp: Date.now() });
    }

    public addRequestInterceptor(interceptor: (req: KickRequest, res: KickResponse, next: KickNextFn) => void): void {
        this.context.app.use((req, res, next) => {
            try {
                interceptor(req, res, next);
            } catch (error) {
                this.handleError(error as Error, { req: req.url, method: req.method });
                next(error);
            }
        });
    }
}

type CreateKickAppOptions = {
    name?: string;
    prefix?: string; // API prefix for all routes
    app: KickApplicationContext["app"];
    plugins?: KickAppPlugin[];
    globalMiddlewares?: KickAppMiddleware[]; // Global/Express middlewares (not managed by DI)
    modules: KickCreateModuleResultType[];
};

export function createKickApp(options: CreateKickAppOptions) {
    const appContext: KickApplicationContext = {
        requestHandlers: {},
        middlewares: [],
        app: options.app,
    };

    const kickApp = new KickApp(appContext, options.name || "KickApp", options.prefix || "");

    console.log(`[KickApp]: Initializing ${kickApp.name}${kickApp.prefix ? ` with prefix: "${kickApp.prefix}"` : ''}`);

    // Load plugins first
    if (options.plugins) {
        kickApp.loadPlugin(options.plugins);
    }

    // Register global middlewares first (these are not managed by DI)
    if (options.globalMiddlewares) {
        console.log(`[KickApp]: Registering ${options.globalMiddlewares.length} global middlewares`);
        kickApp.registerMiddleware(options.globalMiddlewares);
    }

    // Load modules (this will extract DI-managed middlewares from container)
    kickApp.loadModules(options.modules);

    // Mount all middlewares (global + DI-managed) after they've been collected
    kickApp.mountMiddlewares();

    console.log(`[KickApp]: Initialization complete`);
    console.log(`[KickApp]: Stats:`, kickApp.getStats());

    // Create the HTTP server
    const server = createServer(kickApp.context.app);

    // Create a combined object that includes both server methods and KickApp methods
    const kickServer = {
        // Server methods
        listen: server.listen.bind(server),
        close: server.close.bind(server),
        address: server.address.bind(server),
        getConnections: server.getConnections.bind(server),
        on: server.on.bind(server),
        off: server.off.bind(server),
        emit: server.emit.bind(server),
        
        // KickApp instance and methods
        kickApp,
        app: kickApp.context.app,
        
        // Convenience methods
        getStats: () => kickApp.getStats(),
        getState: () => kickApp.state,
        setState: (key: string, value: any) => kickApp.setState(key, value),
        onStateChange: (key: string, listener: any) => kickApp.onStateChange(key, listener),
        onKickEvent: (event: string, listener: any) => kickApp.on(event, listener),
        offKickEvent: (event: string, listener: any) => kickApp.off(event, listener),
        emitKickEvent: (event: string, data?: any) => kickApp.emit(event, data),
        addErrorHandler: (handler: any) => kickApp.addErrorHandler(handler),
        handleError: (error: Error, context?: any) => kickApp.handleError(error, context)
    };

    // Add global error handling for the server
    kickServer.addErrorHandler((errorData: any) => {
        console.error(`[Server:${kickApp.name}] Unhandled error:`, errorData);
    });

    return kickServer;
}
