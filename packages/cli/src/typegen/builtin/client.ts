/**
 * `kick/client` typegen plugin — the self-contained client route map (#543).
 *
 * Part of every one-shot `kick typegen`, with two skips that are requirements
 * rather than options:
 *
 * 1. **Watch.** The pass builds a full `ts.Program` over the server (~11s and
 *    >4 GB on a 1,727-controller app). `kick dev` re-runs typegen on every
 *    save, so emitting there would trade a sub-second loop for an
 *    eleven-second one. The next one-shot run refreshes the file, and
 *    `--check` catches it if that never happens.
 * 2. **No compiler API.** Since this runs for everyone, a project that cannot
 *    load one — most likely TypeScript 7 without `@typescript/typescript6` —
 *    must still get a working `kick typegen`. Warn, skip, carry on. Turning
 *    an additive feature into a hard break for existing projects is not a
 *    tradeoff worth making.
 *
 * Ordering matters — it resolves types out of the map `kick/routes` emits, so
 * it must run after it. Registration order in `plugin/builtins.ts` is the
 * emission order.
 *
 * @module @forinda/kickjs-cli/typegen/builtin/client
 */
import path from 'node:path'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'

import { resolveClientMap } from '../client/resolve-entries'
import { renderClient } from '../render/client'
import { isDebugLog, type TypegenLogger, type TypegenPlugin } from '../plugin'
import type { KickConfig } from '../../config'

const OUT_FILE = '.kickjs/types/kick__client.d.ts'

/**
 * Delete a previously generated client map after a failed one-shot run.
 *
 * Missing beats stale: a frontend importing a deleted file fails to compile
 * immediately and points straight here, while an obsolete map type-checks
 * cleanly against routes that no longer exist.
 */
async function discardStaleOutput(ctx: { cwd: string; log: TypegenLogger }): Promise<boolean> {
  const outFile = path.resolve(ctx.cwd, OUT_FILE)
  // Nothing to discard, and nothing to announce. `rm --force` succeeds either
  // way, so without this check the run claimed to have "removed the previously
  // generated" file in projects that never had one.
  if (!existsSync(outFile)) return false
  try {
    await rm(outFile, { force: true })
  } catch (err) {
    // Best-effort: an unremovable file is not a reason to fail typegen, but
    // it IS a reason to say the map on disk can no longer be trusted.
    ctx.log.warn(
      `  kick/client: could not remove the stale ${OUT_FILE} — treat it as out of date ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    )
    return true
  }
  ctx.log.warn(
    `  kick/client: removed the previously generated ${OUT_FILE} rather than leave a ` +
      `stale one — re-run \`kick typegen\` once the cause above is fixed.`,
  )
  return true
}

/**
 * Whether this project wants the client route map.
 *
 * Producing it builds a whole TypeScript program over the server — 1.1 GB and
 * ~7.6s on a 1,940-route app, against ~130ms for every other typegen plugin
 * combined. An API with no frontend should not pay that for a file nothing
 * reads, and most projects have no frontend.
 *
 * So: `typegen.client` decides when set. Otherwise the existing file decides,
 * which makes the common cases right without anyone configuring anything —
 * a project that has the map keeps it fresh (a stale map is worse than a slow
 * pass), and a project that has never had one never starts paying.
 * `kick new --template fullstack` writes `client: true`, so its web app has
 * the map from the first run.
 */
function clientMapWanted(ctx: { cwd: string; config: KickConfig; log: TypegenLogger }): boolean {
  const configured = ctx.config?.typegen?.client
  if (typeof configured === 'boolean') return configured

  // Unset means off. Inferring "on" from the file being there would work, but
  // it puts the switch somewhere nobody looks — a project would be paying
  // seconds and a gigabyte per typegen because of a file on disk, with nothing
  // in its config to explain why.
  //
  // A map already on disk is still worth a word, though: silently leaving it
  // to rot is how a frontend ends up type-checking against routes the server
  // no longer serves.
  if (existsSync(path.resolve(ctx.cwd, OUT_FILE))) {
    ctx.log.warn(
      `  kick/client: ${OUT_FILE} exists but typegen.client is not set, so it is NOT ` +
        `being refreshed.\n  Add \`typegen: { client: true }\` to kick.config.ts to keep it ` +
        `current, or delete the file if nothing reads it.`,
    )
  }
  return false
}

export const kickClientTypegen = (): TypegenPlugin => ({
  id: 'kick/client',
  outExtension: '.d.ts',
  inputs: ['src/**/*.controller.ts', 'src/**/*.module.ts'],
  async generate(ctx) {
    if (!clientMapWanted(ctx)) return null

    if (ctx.watch) {
      // Not a warning: this is the designed behaviour, and a warning per save
      // would be its own kind of noise.
      ctx.log.info?.(
        `  kick/client: skipped under watch (builds a full TypeScript program). ` +
          `Run \`kick typegen\` to refresh the client route map.`,
      )
      return null
    }

    const scan = await ctx.getScanResult({
      root: path.resolve(ctx.cwd, ctx.config?.typegen?.srcDir ?? 'src'),
      cwd: ctx.cwd,
    })

    // Same key derivation as render/routes.ts, mounted-path preference
    // included — a bare decorator path collides across controllers, and the
    // two maps must agree key for key.
    const keys: string[] = []
    const seen = new Set<string>()
    for (const route of scan.routes) {
      const key = `${route.httpMethod} ${route.mountedPath ?? route.path}`
      if (seen.has(key)) continue
      seen.add(key)
      keys.push(key)
    }

    try {
      const map = await resolveClientMap({
        projectDir: ctx.cwd,
        routesFile: path.resolve(ctx.cwd, '.kickjs/types/kick__routes.ts'),
        keys,
        onWarn: (msg) => ctx.log.warn(msg),
      })
      return renderClient(map, keys)
    } catch (err) {
      // Order matters: discard first, because whether a map was on disk is
      // what decides how loud this should be.
      //
      // A project that has one is USING it, so a skip is a regression and
      // says so. A project that never had one — no frontend, or a TS 7 setup
      // that never installed the compiler API — is not broken, and a warning
      // on every single `kick typegen` would be pure noise for a file it
      // does not consume. loadCompilerApi's message names the install command
      // either way; it just belongs at debug level until someone asks.
      const hadOutput = existsSync(path.resolve(ctx.cwd, OUT_FILE))
      const message = `  kick/client: skipped — ${err instanceof Error ? err.message : String(err)}`
      // Cause first: the removal notice below says "the cause above".
      if (hadOutput) ctx.log.warn(message)
      // `ctx.log` is `console`, whose `debug` still writes to stdout — so the
      // level has to be gated here, on the same LOG_LEVEL convention the
      // plugin runner uses for its per-plugin status list.
      else if (isDebugLog()) ctx.log.info?.(message)
      // Skipping leaves whatever is already on disk, and on a one-shot run
      // that file is now a lie: the routes were rescanned, this map was not
      // rebuilt, and nothing downstream can tell. A MISSING map is a compile
      // error in the frontend — loud, immediate, obviously about this. A
      // STALE one type-checks perfectly against routes the server no longer
      // serves. So remove it, and say that is what happened.
      //
      // Only here. The watch skip returns earlier precisely so the dev loop
      // keeps the last good map.
      if (hadOutput) await discardStaleOutput(ctx)
      return null
    }
  },
})
