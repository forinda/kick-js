import { type ApplicationOptions } from './application';
/**
 * Bootstrap a KickJS application with zero boilerplate.
 *
 * Handles:
 * - Vite HMR (hot-swaps Express handler without restarting the server)
 * - Graceful shutdown on SIGINT / SIGTERM
 * - Global uncaughtException / unhandledRejection handlers
 * - globalThis app storage for HMR rebuild
 *
 * @example
 * ```ts
 * // src/index.ts — that's it, the whole file
 * import 'reflect-metadata'
 * import { bootstrap } from '@forinda/kickjs-http'
 * import { modules } from './modules'
 *
 * bootstrap({ modules })
 * ```
 */
export declare function bootstrap(options: ApplicationOptions): void;
//# sourceMappingURL=bootstrap.d.ts.map