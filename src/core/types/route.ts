import { KickAppMiddleware } from "./application";


// type KickMiddleware = (

export type CreateRouteType = {
  middlewares?: KickAppMiddleware[];
};
export type KickRouteMetadata = {
  path: string;
  method: string;
  handlerName: string;
  handler: Function;
  middlewares?: CreateRouteType["middlewares"];
};
export type KickControllerOptions = {
  middlewares?: KickAppMiddleware[];
};
