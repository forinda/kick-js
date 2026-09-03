/**
 * Declares the suite's route flags, mirroring `context-meta.d.ts` for
 * contributors. Without it `KickRouteFlags` is empty in this program,
 * `RouteFlagName` collapses to `string`, and the narrowing assertions below
 * would pass while proving nothing.
 */
declare module '../src/index' {
  interface KickRouteFlags {
    'auth.public': true
    'rate.limit': { rpm: number }
  }
}

export {}
