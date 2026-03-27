import 'reflect-metadata';
import { Scope, METADATA } from './interfaces';
/** Format a token for display in error messages */
function tokenName(token) {
    if (typeof token === 'symbol')
        return token.toString();
    return token?.name || String(token);
}
/**
 * Inversion-of-Control (IoC) container that manages dependency registration,
 * resolution, and lifecycle. Implements the Singleton pattern so all parts of
 * the application share a single container instance.
 *
 * Supports constructor injection, property injection (@Autowired),
 * factory registrations, and lifecycle hooks (@PostConstruct).
 */
export class Container {
    static instance;
    registrations = new Map();
    resolving = new Set();
    /** Callback set by the decorators module to flush pending registrations */
    static _onReady = null;
    /** Callback invoked on reset so decorators can update their container reference */
    static _onReset = null;
    /**
     * Environment resolver for @Value decorator. Set by @forinda/kickjs-config
     * to return Zod-validated, type-coerced env values instead of raw process.env strings.
     */
    static _envResolver = null;
    static getInstance() {
        if (!Container.instance) {
            Container.instance = new Container();
        }
        // Flush any decorator registrations that queued before the container existed
        if (Container._onReady) {
            Container._onReady(Container.instance);
            Container._onReady = null;
        }
        return Container.instance;
    }
    /**
     * Resets the container by replacing the singleton with a fresh instance.
     * Useful for testing to ensure a clean slate between test runs.
     */
    static reset() {
        Container.instance = new Container();
        // Notify decorators so they update their container reference
        Container._onReset?.(Container.instance);
    }
    /**
     * Create an isolated container instance (not the global singleton).
     * Useful for concurrent tests that must not share DI state.
     *
     * @example
     * ```ts
     * const container = Container.create()
     * container.register(UserService, UserService)
     * const svc = container.resolve(UserService)
     * ```
     */
    static create() {
        return new Container();
    }
    /** Register a class constructor under the given token */
    register(token, target, scope = Scope.SINGLETON) {
        this.registrations.set(token, { target, scope });
        // Store a name-based fallback so HMR class re-creation (new identity)
        // can still resolve by the original class name.
        if (typeof token === 'function' && token.name) {
            this.registrations.set(`__hmr__${token.name}`, { target, scope });
        }
    }
    /** Register a factory function under the given token */
    registerFactory(token, factory, scope = Scope.SINGLETON) {
        this.registrations.set(token, { target: Object, scope, factory });
    }
    /** Register a pre-constructed singleton instance */
    registerInstance(token, instance) {
        this.registrations.set(token, {
            target: instance.constructor,
            scope: Scope.SINGLETON,
            instance,
        });
    }
    /** Check if a binding exists for the given token */
    has(token) {
        return this.registrations.has(token);
    }
    /** Return a snapshot of all registered tokens with their scope and instantiation status */
    getRegistrations() {
        const entries = [];
        for (const [token, reg] of this.registrations) {
            entries.push({
                token: tokenName(token),
                scope: reg.scope,
                instantiated: reg.instance !== undefined,
            });
        }
        return entries;
    }
    /** Resolve a dependency by its token */
    resolve(token) {
        let reg = this.registrations.get(token);
        // HMR fallback: when Vite re-evaluates a module, decorated classes get new
        // identity. Try resolving by class name if the primary token lookup fails.
        if (!reg && typeof token === 'function' && token.name) {
            reg = this.registrations.get(`__hmr__${token.name}`);
        }
        if (!reg) {
            throw new Error(`No binding found for: ${tokenName(token)}`);
        }
        if (reg.scope === Scope.SINGLETON && reg.instance !== undefined) {
            return reg.instance;
        }
        if (reg.factory) {
            const instance = reg.factory();
            if (reg.scope === Scope.SINGLETON) {
                reg.instance = instance;
            }
            return instance;
        }
        if (this.resolving.has(token)) {
            const chain = [...this.resolving].map(tokenName);
            chain.push(tokenName(token));
            throw new Error(`Circular dependency detected: ${chain.join(' -> ')}`);
        }
        this.resolving.add(token);
        try {
            const instance = this.createInstance(reg);
            if (reg.scope === Scope.SINGLETON) {
                reg.instance = instance;
            }
            return instance;
        }
        finally {
            this.resolving.delete(token);
        }
    }
    /** Lifecycle hook called during Application.setup() after module registration */
    bootstrap() {
        // Reserved for future use — adapters and modules register via
        // container.register(), registerFactory(), and registerInstance().
    }
    createInstance(reg) {
        const paramTypes = Reflect.getMetadata(METADATA.PARAM_TYPES, reg.target) || [];
        const args = paramTypes.map((paramType, index) => {
            // Check for @Inject token override on constructor parameter
            const injectTokens = Reflect.getMetadata(METADATA.INJECT, reg.target) || {};
            const token = injectTokens[index] || paramType;
            return this.resolve(token);
        });
        const instance = new reg.target(...args);
        // Property injection via @Autowired
        this.injectProperties(instance, reg.target);
        // @PostConstruct lifecycle hook
        const postConstruct = Reflect.getMetadata(METADATA.POST_CONSTRUCT, reg.target.prototype);
        if (postConstruct && typeof instance[postConstruct] === 'function') {
            instance[postConstruct]();
        }
        return instance;
    }
    injectProperties(instance, target) {
        // @Autowired — lazy DI property injection
        const autowiredProps = Reflect.getMetadata(METADATA.AUTOWIRED, target.prototype) || new Map();
        for (const [prop, token] of autowiredProps) {
            const resolvedToken = token || Reflect.getMetadata(METADATA.PROPERTY_TYPE, target.prototype, prop);
            if (resolvedToken) {
                Object.defineProperty(instance, prop, {
                    get: () => this.resolve(resolvedToken),
                    enumerable: true,
                    configurable: true,
                });
            }
        }
        // @Value — lazy environment variable injection
        const valueProps = Reflect.getMetadata(METADATA.VALUE, target.prototype) || new Map();
        for (const [prop, config] of valueProps) {
            Object.defineProperty(instance, prop, {
                get() {
                    // Use the registered env resolver if available (set by @forinda/kickjs-config)
                    // This returns Zod-validated, type-coerced values (e.g. PORT as number)
                    if (Container._envResolver) {
                        const val = Container._envResolver(config.envKey);
                        if (val !== undefined)
                            return val;
                    }
                    // Fallback to raw process.env for apps not using @forinda/kickjs-config
                    const val = process.env[config.envKey];
                    if (val !== undefined)
                        return val;
                    if (config.defaultValue !== undefined)
                        return config.defaultValue;
                    throw new Error(`@Value('${config.envKey}'): Environment variable "${config.envKey}" is not set and no default was provided.`);
                },
                enumerable: true,
                configurable: true,
            });
        }
    }
}
//# sourceMappingURL=container.js.map