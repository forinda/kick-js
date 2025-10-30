import { KickApplicationContext, KickAppPlugin } from "../types/application";

export abstract class BaseKickPlugin implements KickAppPlugin {
  /**
   * Installs the plugin into the application context.
   * The context parameter provides access to the application's components and modules.
   * @param {KickApplicationContext} context
   */
  abstract install(context: KickApplicationContext): void;
}
