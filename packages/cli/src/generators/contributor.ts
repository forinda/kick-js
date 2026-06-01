import { join } from 'node:path'
import { writeFileSafe } from '../utils/fs'
import { toPascalCase, toKebabCase, toCamelCase } from '../utils/naming'
import { resolveOutDir } from '../utils/resolve-out-dir'
import type { ProjectPattern } from '../config'

/**
 * Context-contributor generator (#107). Scaffolds a Context Contributor
 * — the typed, ordered alternative to `@Middleware()` for populating
 * `ctx.set(key, value)` before a handler runs.
 *
 * Two flavours via `--type`:
 *  - `http` (default) → `defineHttpContextDecorator`, resolver typed
 *    against `RequestContext` (`ctx.req`, `ctx.headers`, `ctx.params`).
 *  - `bare` → `defineContextDecorator`, resolver typed against the
 *    transport-agnostic `ExecutionContext` (HTTP + WS + queue + cron).
 *
 * When `--params` is supplied, the curried `.withParams<T>()` form is
 * emitted (per-call parameters with full inference), mirroring how
 * `kick g scaffold` takes field definitions.
 */

export type ContributorType = 'http' | 'bare'

/** One parsed `--params` entry, e.g. `source:string` → `{ name, type }`. */
export interface ContributorParam {
  name: string
  type: string
}

export interface GenerateContributorOptions {
  name: string
  /** `http` (RequestContext) or `bare` (ExecutionContext). Default `http`. */
  type?: ContributorType
  /** Context key the contributor writes. Defaults to camelCase(name). */
  key?: string
  /**
   * Per-call params. When non-empty, the `.withParams<T>()` curried form
   * is generated. Accepts the parsed array or a raw `a:string,b:number`
   * string (see {@link parseContributorParams}).
   */
  params?: ContributorParam[] | string
  outDir?: string
  moduleName?: string
  modulesDir?: string
  pattern?: ProjectPattern
  pluralize?: boolean
}

/**
 * Parse a `--params` string (`source:string,region:number`) into typed
 * fields. Whitespace tolerant; entries without an explicit `:type`
 * default to `string`. Returns `[]` for empty/undefined input.
 */
export function parseContributorParams(raw: string | undefined): ContributorParam[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, type] = entry.split(':').map((s) => s.trim())
      return { name, type: type || 'string' }
    })
    .filter((p) => p.name.length > 0)
}

/** Safe primitive default for `paramDefaults` so the scaffold compiles. */
function defaultForType(type: string): string | null {
  switch (type) {
    case 'string':
      return "''"
    case 'number':
      return '0'
    case 'boolean':
      return 'false'
    default:
      // Non-primitive — omit from paramDefaults (the field is `Partial<P>`)
      // so we don't emit an un-typeable placeholder.
      return null
  }
}

export async function generateContributor(options: GenerateContributorOptions): Promise<string[]> {
  const { name, moduleName, modulesDir, pattern } = options
  const type: ContributorType = options.type ?? 'http'
  const kebab = toKebabCase(name)
  const pascal = toPascalCase(name)
  const key = options.key ?? toCamelCase(name)
  const params = Array.isArray(options.params)
    ? options.params
    : parseContributorParams(options.params)

  const outDir = resolveOutDir({
    type: 'contributor',
    outDir: options.outDir,
    moduleName,
    modulesDir,
    defaultDir: 'src/contributors',
    pattern,
    shouldPluralize: options.pluralize ?? true,
  })

  const factory = type === 'http' ? 'defineHttpContextDecorator' : 'defineContextDecorator'
  const ctxType = type === 'http' ? 'RequestContext' : 'ExecutionContext'

  // Emit a `type` alias, NOT an `interface`: `withParams<P>` constrains
  // `P extends Record<string, unknown>`, and an object-literal type alias
  // satisfies that index-signature constraint whereas an interface does
  // not (TS2344).
  const paramsInterface =
    params.length > 0
      ? `\nexport type ${pascal}Params = {\n${params
          .map((p) => `  ${p.name}: ${p.type}`)
          .join('\n')}\n}\n`
      : ''

  // `.withParams<T>()(...)` curried form when params are supplied; the
  // plain `factory({...})` form otherwise.
  const callOpen = params.length > 0 ? `${factory}.withParams<${pascal}Params>()({` : `${factory}({`

  const paramDefaultsEntries = params
    .map((p) => ({ name: p.name, def: defaultForType(p.type) }))
    .filter((p) => p.def !== null)
    .map((p) => `    ${p.name}: ${p.def},`)
  const paramDefaultsBlock =
    params.length > 0 ? `  paramDefaults: {\n${paramDefaultsEntries.join('\n')}\n  },\n` : ''

  const resolveSig = params.length > 0 ? '(ctx, _deps, params)' : '(ctx)'
  const resolveHint =
    params.length > 0
      ? `    // \`params\` is typed as ${pascal}Params (call-site overrides merged onto paramDefaults).`
      : `    // \`ctx\` is a ${ctxType} — read ctx.req / ctx.headers / ctx.params (http) or ctx.get (bare).`

  const content = `import { ${factory} } from '@forinda/kickjs'
import type { ${ctxType} } from '@forinda/kickjs'

/**
 * ${pascal} context contributor (${type}).
 *
 * Computes a value and writes it to \`ctx.set('${key}', …)\` before a
 * matched handler runs — the typed, ordered alternative to
 * \`@Middleware()\` when the only job is to populate \`ctx\`.
 *
 * Apply per method/class, or register globally via
 * \`bootstrap({ contributors: [${pascal}] })\`:
 *
 *   @${pascal}${params.length > 0 ? `({ ${params[0]?.name}: … })` : ''}
 *   @Get('/')
 *   handler(ctx: ${ctxType}) {
 *     return ctx.json(ctx.get('${key}'))
 *   }
 */

// Register '${key}' so \`ctx.get('${key}')\` is typed and \`dependsOn: ['${key}']\`
// is checked. Replace \`unknown\` with the resolved value's real type.
// (For a key you only depend on — no value type needed — declare it in
// \`interface ContextKeys\` instead.)
declare module '@forinda/kickjs' {
  interface ContextMeta {
    '${key}': unknown
  }
}
${paramsInterface}
export const ${pascal} = ${callOpen}
  key: '${key}',
${paramDefaultsBlock}  resolve: ${resolveSig} => {
${resolveHint}
    // TODO: compute and return the value written to ctx.set('${key}', …)
    throw new Error("${pascal} contributor: resolve() not implemented")
  },
})
`

  const filePath = join(outDir, `${kebab}.contributor.ts`)
  await writeFileSafe(filePath, content)
  return [filePath]
}
