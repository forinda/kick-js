import { KickRequestHandler } from "./http";
import { KickRouteMetadata } from "./route";
import { Application } from "express";
import { KickAppConfig } from "../../cli/types";

/**
 * The application context interface for KickJS applications.
 * Holds request handlers, middlewares, and the Express application instance.
 */
export interface KickApplicationContext {
  requestHandlers: Record<string, KickRouteMetadata>;
  middlewares: KickAppMiddleware[];
  app: Application;
}
/**
 * A middleware handler function that operates on the application context.
 * @param context - The application context.
 * @returns A promise that resolves when the middleware has completed its operation.
 */
export interface KickAppMiddleware {
  use: KickRequestHandler;
}

export type KickAppPlugin = {
  install: (context: KickApplicationContext) => void;
};

export interface KickApplication {
  context: KickApplicationContext;
  name: string;
  config?: KickAppConfig;
}
