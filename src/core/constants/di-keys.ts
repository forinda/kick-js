export const KICK_MODULE_KEYS = {
  KickControllerType: Symbol.for("Kick:ControllerType"),
};

export const KICK_CONTROLLER_METADATA_KEYS = {
  path: Symbol.for("Kick:controller:path"),
  options: Symbol.for("Kick:controller:options"),
  routes: Symbol.for("Kick:controller:routes"),
  middlewares: Symbol.for("Kick:controller:middlewares"),
};