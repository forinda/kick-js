import type * as VType from 'valibot'
import type { KickSchema, SchemaResult, SchemaIssue, JsonSchemaOptions } from '../types.js'
import type { InferSchemaOutput } from '../infer.js'

/**
 * Recognise the specific "optional peer not installed" rejection from
 * `await import(...)`. Bare `catch {}` would also swallow real
 * import-time / evaluation errors (the peer is installed but threw
 * while initialising, or its version is incompatible) — those should
 * surface as the actual crash, not silently degrade to the `null`
 * fallback.
 *
 * Node throws `ERR_MODULE_NOT_FOUND` for ESM dynamic imports and
 * `MODULE_NOT_FOUND` for CJS; the message embeds the missing
 * specifier so a transitive peer crash inside the optional package
 * doesn't match this filter.
 */
function isMissingOptionalPeer(error: unknown, specifier: string): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') return false
  return error.message.includes(specifier)
}

// Resolve the `valibot` peer synchronously at module load. The previous
// static `import * as v from 'valibot'` crashed the entire schema
// package whenever the optional peer wasn't installed — even adopters
// who only used Zod paid the cost because `detect.ts` static-imports
// every adapter for runtime routing. Top-level `await import(...)`
// inside a narrowed try/catch keeps the package loadable when the peer
// is absent; `fromValibot()` then throws the contextual error below on
// first call. Anything *other* than a missing-peer error re-throws so
// init failures surface instead of degrading silently.
let v: typeof VType | null
try {
  v = await import('valibot')
} catch (err) {
  if (!isMissingOptionalPeer(err, 'valibot')) throw err
  v = null
}

const PEER_MISSING_ERROR =
  '@forinda/kickjs-schema/valibot requires the `valibot` peer to be installed. ' +
  'Run `pnpm add valibot` (or your package manager equivalent).'

export function isValibotSchema(schema: unknown): boolean {
  // Pure duck-type — works without the peer installed (callers can
  // ask "is this Valibot?" against arbitrary input even when they
  // never intend to wrap it).
  return (
    schema != null &&
    typeof schema === 'object' &&
    'kind' in (schema as any) &&
    'type' in (schema as any) &&
    'async' in (schema as any)
  )
}

function mapValibotIssues(issues: VType.BaseIssue<unknown>[]): SchemaIssue[] {
  return issues.map((issue) => {
    const mapped: SchemaIssue = {
      path: (issue.path ?? []).map((seg: any) => String(seg?.key ?? seg)),
      message: issue.message ?? 'Validation failed',
      code: issue.type ?? 'unknown',
    }
    if (issue.expected !== undefined) mapped.expected = String(issue.expected)
    if (issue.received !== undefined) mapped.received = String(issue.received)
    return mapped
  })
}

// Resolve `@valibot/to-json-schema` synchronously at module-load via
// top-level await. The previous dangling-promise pattern raced with
// the first `toJsonSchema()` call on fast CI runners — tests that
// asserted on `properties` saw the `{ type: 'object' }` fallback
// because the dynamic import hadn't resolved yet. Top-level await
// blocks the importer until the optional peer either loads or
// confirms it's missing; adopters without the peer installed still
// land at the same `_toJsonSchemaFn = null` fallback (the catch).
let _toJsonSchemaFn: ((schema: any) => Record<string, unknown>) | null
try {
  const mod = await import('@valibot/to-json-schema')
  _toJsonSchemaFn = mod.toJsonSchema as (schema: any) => Record<string, unknown>
} catch (err) {
  if (!isMissingOptionalPeer(err, '@valibot/to-json-schema')) throw err
  _toJsonSchemaFn = null
}

function valibotToJsonSchema(schema: any, _options?: JsonSchemaOptions): Record<string, unknown> {
  if (_toJsonSchemaFn) {
    const { $schema: _, ...rest } = _toJsonSchemaFn(schema)
    return rest
  }
  return { type: 'object' }
}

/** Wrap a Valibot schema as a {@link KickSchema}. See `fromZod` for the
 * inference rationale — `TOutput` flows from the schema's Standard
 * Schema phantom so `kick typegen` can extend `KickEnv` from it. */
export function fromValibot<TSchema>(schema: TSchema): KickSchema<InferSchemaOutput<TSchema>>
export function fromValibot(schema: any): KickSchema<any> {
  if (!v) throw new Error(PEER_MISSING_ERROR)
  const valibot = v
  return {
    safeParse(data: unknown): SchemaResult<any> {
      const result = valibot.safeParse(schema, data)
      if (result.success) {
        return { success: true, data: result.output }
      }
      return { success: false, issues: mapValibotIssues(result.issues) }
    },

    toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown> {
      return valibotToJsonSchema(schema, options)
    },

    _raw: schema,
  }
}

export const valibotAdapter = {
  name: 'valibot' as const,
  detect: isValibotSchema,
  wrap: fromValibot,
}
