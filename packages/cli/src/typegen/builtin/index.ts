// Built-in TypegenPlugins. M2.B-T8 carved `kick/assets` first, then
// `kick/routes` + `kick/env` once the shared scan-state machinery
// (memoized `ctx.getScanResult`) landed; `kick/db` (M2.B-T9) followed.
// Adopters extend the catalog from `kick.config.ts` via the
// `KickCliPlugin.typegens[]` field.

export { kickDbTypegen } from './db'
export { kickRoutesTypegen } from './routes'
export { kickEnvTypegen } from './env'
