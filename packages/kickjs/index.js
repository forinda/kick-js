/**
 * @forinda/kickjs — umbrella package for KickJS framework.
 *
 * This package re-exports the core framework packages for convenience.
 * For granular control, install individual packages:
 *
 *   pnpm add @forinda/kickjs-core @forinda/kickjs-http @forinda/kickjs-config
 *
 * Full list: https://forinda.github.io/kick-js/
 */
export * from '@forinda/kickjs-core'
export { bootstrap, RequestContext, buildRoutes } from '@forinda/kickjs-http'
export { defineEnv, loadEnv, getEnv, ConfigService } from '@forinda/kickjs-config'
