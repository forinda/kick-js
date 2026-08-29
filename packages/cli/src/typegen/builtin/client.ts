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
import { rm } from 'node:fs/promises'

import { resolveClientMap } from '../client/resolve-entries'
import { renderClient } from '../render/client'
import type { TypegenLogger, TypegenPlugin } from '../plugin'

const OUT_FILE = '.kickjs/types/kick__client.d.ts'

/**
 * Delete a previously generated client map after a failed one-shot run.
 *
 * Missing beats stale: a frontend importing a deleted file fails to compile
 * immediately and points straight here, while an obsolete map type-checks
 * cleanly against routes that no longer exist.
 */
async function discardStaleOutput(ctx: { cwd: string; log: TypegenLogger }): Promise<void> {
  const outFile = path.resolve(ctx.cwd, OUT_FILE)
  try {
    await rm(outFile, { force: true })
  } catch (err) {
    // Best-effort: an unremovable file is not a reason to fail typegen, but
    // it IS a reason to say the map on disk can no longer be trusted.
    ctx.log.warn(
      `  kick/client: could not remove the stale ${OUT_FILE} — treat it as out of date ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    )
    return
  }
  ctx.log.warn(
    `  kick/client: removed the previously generated ${OUT_FILE} rather than leave a ` +
      `stale one — re-run \`kick typegen\` once the cause above is fixed.`,
  )
}

export const kickClientTypegen = (): TypegenPlugin => ({
  id: 'kick/client',
  outExtension: '.d.ts',
  inputs: ['src/**/*.controller.ts', 'src/**/*.module.ts'],
  async generate(ctx) {
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
      // loadCompilerApi's message already names the install command, and a
      // missing tsconfig / unreadable routes file is equally recoverable —
      // every one of them means "skip this file", never "fail the pass".
      ctx.log.warn(`  kick/client: skipped — ${err instanceof Error ? err.message : String(err)}`)
      // Skipping leaves whatever is already on disk, and on a one-shot run
      // that file is now a lie: the routes were rescanned, this map was not
      // rebuilt, and nothing downstream can tell. A MISSING map is a compile
      // error in the frontend — loud, immediate, obviously about this. A
      // STALE one type-checks perfectly against routes the server no longer
      // serves. So remove it, and say that is what happened.
      //
      // Only here. The watch skip returns earlier precisely so the dev loop
      // keeps the last good map.
      await discardStaleOutput(ctx)
      return null
    }
  },
})
