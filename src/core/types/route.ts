type KickMiddleware = Function;

export type CreateRouteType = {
  middlewares?: KickMiddleware[];
};
export type KickRouteMetadata = {
  path: string;
  method: string;
  handlerName: string;
  handler: Function;
  middlewares?: CreateRouteType["middlewares"];
};
export type KickControllerOptions = {
  middlewares?: KickMiddleware[];
};
