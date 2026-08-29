/**
 * Loads a TypeScript compiler API for the client route map.
 *
 * Two things make this more than a dynamic import:
 *
 * 1. **It must come from the project.** A program built by a different
 *    TypeScript than the one checking the server can resolve types
 *    differently, and a client map that disagrees with the server is worse
 *    than no client map at all. So resolution goes through the adopter's
 *    `node_modules`, not the CLI's.
 * 2. **TypeScript 7 ships no JS compiler API.** `typescript` may resolve to a
 *    package that has a version and a binary and no `createProgram` — this
 *    repo's own `typescript@7.0.2` is exactly that, its `lib/` holding
 *    `tsc.js` and `version.cjs` and nothing else. That is the documented
 *    state of TS 7, not a broken install, and the fix is the compatibility
 *    package — so say so by name.
 *
 * @module @forinda/kickjs-cli/typegen/client/ts-compiler
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

export type TsApi = typeof import('@typescript/typescript6')

const TS6 = '@typescript/typescript6'

export interface CompilerCandidates {
  typescript: unknown
  ts6: unknown
}

export interface CompilerPick {
  api: TsApi
  source: 'typescript' | typeof TS6
}

/** Whether a resolved module actually carries the compiler API we need. */
function hasCompilerApi(mod: unknown): mod is TsApi {
  return typeof (mod as { createProgram?: unknown } | null)?.createProgram === 'function'
}

/**
 * Choose between the two candidates. Split from the I/O so the decision —
 * which is the part with the interesting cases — is testable without a
 * node_modules tree.
 */
export function pickCompilerModule(candidates: CompilerCandidates): CompilerPick {
  if (hasCompilerApi(candidates.typescript)) {
    return { api: candidates.typescript, source: 'typescript' }
  }
  if (hasCompilerApi(candidates.ts6)) {
    return { api: candidates.ts6, source: TS6 }
  }
  const install = `Install it in the project:\n    pnpm add -D ${TS6}`
  if (candidates.typescript) {
    throw new Error(
      `kick typegen: the client route map needs a TypeScript compiler API.\n` +
        `  TypeScript 7 does not ship a compiler API, so the compatibility ` +
        `package is required.\n  ${install}`,
    )
  }
  throw new Error(
    `kick typegen: the client route map needs a TypeScript compiler API, and neither ` +
      `'typescript' nor '${TS6}' resolved from this project.\n  ${install}`,
  )
}

/**
 * Resolve and import a compiler API from `projectDir`. Returns the `ts`
 * namespace.
 */
export async function loadCompilerApi(projectDir: string): Promise<TsApi> {
  const require = createRequire(join(projectDir, 'package.json'))
  const load = async (name: string): Promise<unknown> => {
    try {
      return await import(pathToFileURL(require.resolve(name)).href)
    } catch {
      // Unresolvable and unloadable both mean "not a candidate" —
      // pickCompilerModule turns the absence into the actionable message.
      return null
    }
  }
  const [typescript, ts6] = await Promise.all([load('typescript'), load(TS6)])
  return pickCompilerModule({
    typescript: unwrapDefault(typescript),
    ts6: unwrapDefault(ts6),
  }).api
}

/** Both packages are CJS — the namespace lands on `.default` under ESM import. */
function unwrapDefault(mod: unknown): unknown {
  const withDefault = mod as { default?: unknown } | null
  if (withDefault?.default && typeof withDefault.default === 'object') return withDefault.default
  return mod
}
