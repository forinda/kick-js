/**
 * Request validators and JSON Schema from a kick/db table.
 *
 *   import { insertSchema, selectSchema, updateSchema } from '@forinda/kickjs-db/schema'
 *
 *   export const createUser = insertSchema(users, {
 *     columns: { email: { format: 'email' }, name: { minLength: 1 } },
 *     omit: ['id'],
 *   })
 *
 *   @Post('/', { body: createUser })   // validated + typed ctx.body + OpenAPI
 *
 * The result is a `KickSchema` (`safeParse` + `toJsonSchema`), so request
 * validation, the Swagger spec, `kick typegen` and the typed client take it
 * the way they take a wrapped Zod schema — and a Standard Schema
 * (`~standard`), for libraries that accept those. No schema library needed.
 *
 * Each column's rule comes from its SQL type and nullability. A table can't
 * say a column holds an email or a minimum length, and `json` / custom
 * columns have no runtime shape — `columns` adds those: a rule object, or a
 * whole schema (e.g. `fromZod(...)`) for the column.
 *
 * - `selectSchema` — a row as read: every column present, nullable ones may be null.
 * - `insertSchema` — a row to insert: columns the database fills (serial, a
 *   default, nullable) are optional.
 * - `updateSchema` — a patch: every column optional.
 *
 * Unknown keys are dropped from the parsed value, like a Zod object.
 */
import { CustomColumnBuilder } from './custom-type'
import type { ColumnBuilder, GeneratedBrand, NotNullBrand } from './dsl/columns/types'
import { PgEnumColumnBuilder } from './dsl/columns/pg'
import type { TableDecl } from './dsl/table'

// ── Types ───────────────────────────────────────────────────────────────

type ColumnsOf<T> = T extends TableDecl<string, infer C, string | undefined> ? C : never
type ValueOf<C> = C extends ColumnBuilder<infer V> ? V : never
type IsNotNull<C> = C extends NotNullBrand ? true : false

/** A row as read from the table. */
export type InferSelect<T extends TableDecl> = {
  [K in keyof ColumnsOf<T>]: IsNotNull<ColumnsOf<T>[K]> extends true
    ? ValueOf<ColumnsOf<T>[K]>
    : ValueOf<ColumnsOf<T>[K]> | null
}

type OptionalOnInsert<T> = {
  [K in keyof ColumnsOf<T>]: ColumnsOf<T>[K] extends GeneratedBrand
    ? K
    : IsNotNull<ColumnsOf<T>[K]> extends true
      ? never
      : K
}[keyof ColumnsOf<T>]

/** A row to insert: generated, defaulted and nullable columns may be left out. */
export type InferInsert<T extends TableDecl> = Omit<InferSelect<T>, OptionalOnInsert<T>> &
  Partial<Pick<InferSelect<T>, OptionalOnInsert<T>>>

/** Extra rules for one column — what a SQL type can't say. */
export interface ColumnRule {
  /** JSON Schema `format`; `email`, `uri`, `uuid` and `date-time` are also checked. */
  format?: string
  minLength?: number
  maxLength?: number
  /** Checked against the whole string. */
  pattern?: string
  minimum?: number
  maximum?: number
}

/** Anything with `safeParse` + `toJsonSchema` — a `KickSchema` (e.g. `fromZod(...)`). */
export interface SchemaLike {
  safeParse(data: unknown): { success: true; data: unknown } | { success: false; issues: unknown[] }
  toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown>
}

export interface TableSchemaOptions<T extends TableDecl> {
  columns?: { [K in keyof ColumnsOf<T>]?: ColumnRule | SchemaLike }
  /** Columns left out of the schema entirely (e.g. `password` on a read). */
  omit?: readonly (keyof ColumnsOf<T>)[]
}

export interface JsonSchemaOptions {
  readonly target?: 'draft-2020-12' | 'draft-07' | 'openapi-3.0'
}

export interface SchemaIssue {
  path: string[]
  message: string
  code: string
}

/** The schema these functions return — structurally a `KickSchema<TOutput>` and a Standard Schema. */
export interface TableSchema<TOutput> {
  safeParse(
    data: unknown,
  ): { success: true; data: TOutput } | { success: false; issues: SchemaIssue[] }
  toJsonSchema(options?: JsonSchemaOptions): Record<string, unknown>
  readonly '~standard': {
    readonly version: 1
    readonly vendor: 'kickjs-db'
    readonly validate: (
      value: unknown,
    ) =>
      | { value: TOutput; issues?: undefined }
      | { issues: ReadonlyArray<{ message: string; path: readonly string[] }> }
    readonly types?: { readonly input: unknown; readonly output: TOutput }
  }
}

// ── Column rules ────────────────────────────────────────────────────────

type Parsed = { ok: true; value: unknown } | { ok: false; message: string; code: string }

interface ColumnSpec {
  json: Record<string, unknown>
  /** For a whole-schema override: its JSON Schema in the caller's target. */
  jsonFor?: (options: JsonSchemaOptions) => Record<string, unknown>
  parse(value: unknown): Parsed
}

const ok = (value: unknown): Parsed => ({ ok: true, value })
const fail = (message: string, code = 'invalid_type'): Parsed => ({ ok: false, message, code })

const INTEGER = /^-?\d+$/
const DECIMAL = /^-?\d+(\.\d+)?$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * An integer the column can store. Out of range, the database would reject
 * the insert with a server error; here it is a validation issue instead.
 */
function integerSpec(minimum: number, maximum: number): ColumnSpec {
  return {
    json: { type: 'integer', minimum, maximum },
    parse: (v) =>
      typeof v !== 'number' || !Number.isInteger(v)
        ? fail('Expected an integer')
        : v < minimum || v > maximum
          ? fail(`Must be between ${minimum} and ${maximum}`, v < minimum ? 'too_small' : 'too_big')
          : ok(v),
  }
}

const INT16 = 32_767
const INT32 = 2_147_483_647
const INT64 = 2n ** 63n

function stringSpec(json: Record<string, unknown> = {}, check?: (v: string) => string | null) {
  return {
    json: { type: 'string', ...json },
    parse: (v: unknown): Parsed => {
      if (typeof v !== 'string') return fail('Expected a string')
      const problem = check?.(v)
      return problem ? fail(problem, 'invalid_string') : ok(v)
    },
  }
}

function dateSpec(format: 'date' | 'date-time'): ColumnSpec {
  return {
    json: { type: 'string', format },
    parse: (v) => {
      const date = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : undefined
      return date && !Number.isNaN(date.getTime())
        ? ok(date)
        : fail(`Expected a ${format === 'date' ? 'date' : 'date-time'} string`)
    },
  }
}

/** The rule for one column, from its SQL type. */
function specFor(builder: ColumnBuilder): ColumnSpec {
  if (builder instanceof PgEnumColumnBuilder) {
    const values = builder.values as readonly string[]
    return {
      json: { type: 'string', enum: [...values] },
      parse: (v) =>
        typeof v === 'string' && values.includes(v)
          ? ok(v)
          : fail(`Expected one of ${values.join(', ')}`, 'invalid_enum_value'),
    }
  }
  if (builder instanceof CustomColumnBuilder) return anySpec()

  const type = builder.__state().type.toLowerCase()
  if (type.endsWith('[]')) return arraySpec(specForType(type.slice(0, -2)))
  return specForType(type)
}

function anySpec(): ColumnSpec {
  return { json: {}, parse: ok }
}

function arraySpec(item: ColumnSpec, length?: number): ColumnSpec {
  return {
    json: {
      type: 'array',
      items: item.json,
      ...(length === undefined ? {} : { minItems: length, maxItems: length }),
    },
    parse: (v) => {
      if (!Array.isArray(v)) return fail('Expected an array')
      if (length !== undefined && v.length !== length) {
        return fail(`Expected ${length} items`, 'invalid_length')
      }
      const out: unknown[] = []
      for (const [i, element] of v.entries()) {
        const parsed = item.parse(element)
        if (!parsed.ok) return fail(`[${i}]: ${parsed.message}`, parsed.code)
        out.push(parsed.value)
      }
      return ok(out)
    },
  }
}

function specForType(type: string): ColumnSpec {
  const base = type.replace(/\(.*$/, '').trim()
  const size = Number(/\((\d+)/.exec(type)?.[1])
  switch (base) {
    // serial values start at 1.
    case 'smallserial':
      return integerSpec(1, INT16)
    case 'serial':
      return integerSpec(1, INT32)
    case 'smallint':
      return integerSpec(-INT16 - 1, INT16)
    case 'integer':
    case 'int':
      return integerSpec(-INT32 - 1, INT32)
    case 'bigserial':
    case 'bigint':
      // JSON has no 64-bit integer: accept a number or a string of digits,
      // parse to the column's TS type, bigint.
      return {
        json: { type: 'string', pattern: INTEGER.source },
        parse: (v) => {
          if (
            !(typeof v === 'number' && Number.isInteger(v)) &&
            !(typeof v === 'string' && INTEGER.test(v))
          ) {
            return fail('Expected an integer or a string of digits')
          }
          const n = BigInt(v)
          return n < -INT64 || n >= INT64
            ? fail('Out of range for a 64-bit integer', 'too_big')
            : ok(n)
        },
      }
    case 'real':
    case 'double precision':
      return {
        json: { type: 'number' },
        parse: (v) =>
          typeof v === 'number' && Number.isFinite(v) ? ok(v) : fail('Expected a number'),
      }
    case 'decimal':
    case 'numeric':
    case 'money':
      // The column's TS type is string — exact decimals don't survive a float.
      return {
        json: { type: 'string', pattern: DECIMAL.source },
        parse: (v) =>
          typeof v === 'number' && Number.isFinite(v)
            ? ok(String(v))
            : typeof v === 'string' && DECIMAL.test(v)
              ? ok(v)
              : fail('Expected a decimal number or string'),
      }
    case 'varchar':
    case 'character varying':
    case 'char':
    case 'character':
      return Number.isFinite(size)
        ? stringSpec({ maxLength: size }, (v) =>
            v.length > size ? `Must be at most ${size} characters` : null,
          )
        : stringSpec()
    case 'boolean':
      return {
        json: { type: 'boolean' },
        parse: (v) => (typeof v === 'boolean' ? ok(v) : fail('Expected a boolean')),
      }
    case 'timestamp':
    case 'timestamptz':
      return dateSpec('date-time')
    case 'date':
      return dateSpec('date')
    case 'uuid':
      return stringSpec({ format: 'uuid' }, (v) => (UUID.test(v) ? null : 'Expected a UUID'))
    case 'vector':
      return arraySpec(
        {
          json: { type: 'number' },
          parse: (v) => (typeof v === 'number' ? ok(v) : fail('Expected a number')),
        },
        Number.isFinite(size) ? size : undefined,
      )
    case 'json':
    case 'jsonb':
      return anySpec()
    default:
      // text, citext, time, interval, inet, cidr, xml, tsvector, bytea (base64)
      return stringSpec()
  }
}

function isSchemaLike(value: unknown): value is SchemaLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SchemaLike).safeParse === 'function' &&
    typeof (value as SchemaLike).toJsonSchema === 'function'
  )
}

/** Layer a column's extra rules over its type rule. */
function withRule(spec: ColumnSpec, rule: ColumnRule | SchemaLike | undefined): ColumnSpec {
  if (!rule) return spec
  if (isSchemaLike(rule)) {
    return {
      json: rule.toJsonSchema(),
      jsonFor: (options) => rule.toJsonSchema(options),
      parse: (v) => {
        const result = rule.safeParse(v)
        if (result.success) return ok(result.data)
        const first = result.issues[0] as { message?: string } | undefined
        return fail(first?.message ?? 'Invalid value', 'custom')
      },
    }
  }
  const pattern = rule.pattern === undefined ? undefined : new RegExp(`^(?:${rule.pattern})$`)
  return {
    json: { ...spec.json, ...rule },
    parse: (v) => {
      const parsed = spec.parse(v)
      if (!parsed.ok) return parsed
      const value = parsed.value
      if (typeof value === 'string') {
        if (rule.minLength !== undefined && value.length < rule.minLength) {
          return fail(`Must be at least ${rule.minLength} characters`, 'too_small')
        }
        if (rule.maxLength !== undefined && value.length > rule.maxLength) {
          return fail(`Must be at most ${rule.maxLength} characters`, 'too_big')
        }
        if (pattern && !pattern.test(value)) return fail('Invalid format', 'invalid_string')
        const formatProblem = checkFormat(rule.format, value)
        if (formatProblem) return fail(formatProblem, 'invalid_string')
      }
      if (typeof value === 'number') {
        if (rule.minimum !== undefined && value < rule.minimum) {
          return fail(`Must be at least ${rule.minimum}`, 'too_small')
        }
        if (rule.maximum !== undefined && value > rule.maximum) {
          return fail(`Must be at most ${rule.maximum}`, 'too_big')
        }
      }
      return parsed
    },
  }
}

function checkFormat(format: string | undefined, value: string): string | null {
  switch (format) {
    case 'email':
      return EMAIL.test(value) ? null : 'Expected an email address'
    case 'uuid':
      return UUID.test(value) ? null : 'Expected a UUID'
    case 'uri':
    case 'url':
      return URL.canParse(value) ? null : 'Expected a URL'
    case 'date-time':
      return Number.isNaN(Date.parse(value)) ? 'Expected a date-time string' : null
    default:
      return null
  }
}

// ── Schemas ─────────────────────────────────────────────────────────────

type Mode = 'select' | 'insert' | 'update'

/** Whether a column may be left out of an insert: the database fills it. */
function optionalOnInsert(builder: ColumnBuilder): boolean {
  const state = builder.__state()
  return state.nullable || state.default !== null || /^(small|big)?serial$/.test(state.type)
}

function buildSchema<TOutput>(
  table: TableDecl,
  mode: Mode,
  options: TableSchemaOptions<TableDecl> = {},
): TableSchema<TOutput> {
  const omitted = new Set<string>((options.omit ?? []) as string[])
  const columns = Object.entries(table.__columns)
    .filter(([name]) => !omitted.has(name))
    .map(([name, builder]) => ({
      name,
      nullable: builder.__state().nullable,
      required: mode === 'select' || (mode === 'insert' && !optionalOnInsert(builder)),
      // `columns` overrides a rule the table form declared.
      spec: withRule(
        specFor(builder),
        (options.columns as Record<string, ColumnRule | SchemaLike> | undefined)?.[name] ??
          (table.__rules?.[name] as ColumnRule | SchemaLike | undefined),
      ),
    }))

  const safeParse = (data: unknown) => {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return {
        success: false as const,
        issues: [{ path: [], message: 'Expected an object', code: 'invalid_type' }],
      }
    }
    const input = data as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const issues: SchemaIssue[] = []
    for (const column of columns) {
      const value = input[column.name]
      if (value === undefined) {
        if (column.required) {
          issues.push({ path: [column.name], message: 'Required', code: 'invalid_type' })
        }
        continue
      }
      if (value === null) {
        if (column.nullable) out[column.name] = null
        else issues.push({ path: [column.name], message: 'Cannot be null', code: 'invalid_type' })
        continue
      }
      const parsed = column.spec.parse(value)
      if (parsed.ok) out[column.name] = parsed.value
      else issues.push({ path: [column.name], message: parsed.message, code: parsed.code })
    }
    return issues.length > 0
      ? { success: false as const, issues }
      : { success: true as const, data: out as TOutput }
  }

  const toJsonSchema = (jsonOptions: JsonSchemaOptions = {}) => {
    const openapi = jsonOptions.target === 'openapi-3.0'
    const properties: Record<string, unknown> = {}
    for (const column of columns) {
      const json = column.spec.jsonFor?.(jsonOptions) ?? column.spec.json
      properties[column.name] = !column.nullable
        ? json
        : openapi
          ? { ...json, nullable: true }
          : { anyOf: [json, { type: 'null' }] }
    }
    const required = columns.filter((c) => c.required).map((c) => c.name)
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    }
  }

  return {
    safeParse,
    toJsonSchema,
    '~standard': {
      version: 1,
      vendor: 'kickjs-db',
      validate: (value: unknown) => {
        const result = safeParse(value)
        return result.success ? { value: result.data } : { issues: result.issues }
      },
    },
  }
}

/** A row as read: every column present, nullable ones may be `null`. */
export function selectSchema<T extends TableDecl, const O extends keyof ColumnsOf<T> = never>(
  table: T,
  options?: TableSchemaOptions<T> & { omit?: readonly O[] },
): TableSchema<Omit<InferSelect<T>, O>> {
  return buildSchema(table, 'select', options as TableSchemaOptions<TableDecl>)
}

/** A row to insert: serial, defaulted and nullable columns are optional. */
export function insertSchema<T extends TableDecl, const O extends keyof ColumnsOf<T> = never>(
  table: T,
  options?: TableSchemaOptions<T> & { omit?: readonly O[] },
): TableSchema<Omit<InferInsert<T>, O>> {
  return buildSchema(table, 'insert', options as TableSchemaOptions<TableDecl>)
}

/** A patch: every column optional. */
export function updateSchema<T extends TableDecl, const O extends keyof ColumnsOf<T> = never>(
  table: T,
  options?: TableSchemaOptions<T> & { omit?: readonly O[] },
): TableSchema<Partial<Omit<InferInsert<T>, O>>> {
  return buildSchema(table, 'update', options as TableSchemaOptions<TableDecl>)
}
