/**
 * Typed configuration sections: one schema per concern (`DB`, `MAIL`,
 * `STORAGE`), each read from its own prefix of the environment and injected
 * where it's needed — instead of one flat env every service reaches into.
 * Spring's `@ConfigurationProperties`, for any schema `@forinda/kickjs-schema`
 * reads — Zod, Valibot, Yup.
 *
 * @module @forinda/kickjs/config/settings
 */
import { detectSchema, type InferSchemaOutput } from '@forinda/kickjs-schema'
import { INJECTION_TOKEN, type InjectionToken } from '../core/token'
import { Container } from '../core/container'

/**
 * Reads `<NAME>_FILE` secrets. Registered by `./env` (Node only) when it
 * loads — this module imports nothing node-only, so the web entry can use it;
 * there, `_FILE` variables are simply not read.
 */
type SecretFileReader = (
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
) => Record<string, string | undefined>
let readSecretFiles: SecretFileReader | undefined

/** @internal */
export function _useSecretFileReader(reader: SecretFileReader): void {
  readSecretFiles = reader
}

/** A section: an injection token that also knows how to load itself. */
export interface Settings<T> extends InjectionToken<T> {
  /** The env prefix, e.g. `'DB'`. */
  readonly prefix: string
  /** Every env name the section reads, e.g. `['DB_URL', 'DB_POOL_MAX']`. */
  readonly envNames: readonly string[]
  /**
   * The section's value — validated at startup, then cached. Before startup
   * (a script, a CLI command) the first call loads and validates it.
   */
  get(): T
  /** Parse the section from `env` (default `process.env`) afresh; throws listing every problem. */
  load(env?: NodeJS.ProcessEnv): T
  /** Each variable the section reads — required or not, default, description. Reads no env. */
  describe(): ConfigVar[]
  /**
   * The same schema under another prefix, for a second instance:
   * `DbSettings.scoped('ANALYTICS')` reads `ANALYTICS_DB_*` beside `DB_*`.
   * Returns the same token for the same name.
   */
  scoped(name: string): Settings<T>
}

/** The value type of a section: `SettingsOf<typeof DbSettings>`. */
export type SettingsOf<S> = S extends Settings<infer T> ? T : never

interface Leaf {
  path: string[]
  env: string
  list: boolean
  required: boolean
  default?: unknown
  description?: string
}

/** One variable, as `describe()` and `app.describeConfig()` report it. */
export interface ConfigVar {
  name: string
  /** Startup fails without it: required by the schema, with no default. */
  required: boolean
  /** The schema's default, when it has one. */
  default?: unknown
  /** The schema's description (`.describe('…')` in Zod). */
  description?: string
  /** Read as a comma-separated list. */
  list: boolean
}

/** The part of a JSON schema the env mapping reads. */
interface JsonShape {
  type?: string | string[]
  properties?: Record<string, JsonShape>
  required?: string[]
  default?: unknown
  description?: string
}

/** `maxConnections` → `MAX_CONNECTIONS`. */
const envSegment = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()

/**
 * The variables a JSON-schema shape reads. A leaf is required when every
 * object on its path is required by its parent and none of them (nor the leaf)
 * has a default — a defaulted parent object supplies its children.
 */
function leavesOf(shape: JsonShape, prefix: string, path: string[] = [], required = true): Leaf[] {
  if (shape.properties) {
    const own = new Set(shape.required ?? [])
    const parentRequired = required && shape.default === undefined
    return Object.entries(shape.properties).flatMap(([key, child]) =>
      leavesOf(child, prefix, [...path, key], parentRequired && own.has(key)),
    )
  }
  const types = Array.isArray(shape.type) ? shape.type : [shape.type]
  return [
    {
      path,
      env: [prefix, ...path.map(envSegment)].join('_'),
      list: types.includes('array'),
      required: required && shape.default === undefined,
      ...(shape.default !== undefined ? { default: shape.default } : {}),
      ...(shape.description ? { description: shape.description } : {}),
    },
  ]
}

const toConfigVar = (leaf: Leaf): ConfigVar => ({
  name: leaf.env,
  required: leaf.required,
  list: leaf.list,
  ...(leaf.default !== undefined ? { default: leaf.default } : {}),
  ...(leaf.description ? { description: leaf.description } : {}),
})

/**
 * The variables of a flat schema (the app's env schema), described the same
 * way — no prefix, top-level keys only.
 */
export function describeSchemaVars(schema: unknown): ConfigVar[] {
  const shape = detectSchema(schema).toJsonSchema() as JsonShape
  const required = new Set(shape.required ?? [])
  // The keys of an env schema are the variable names themselves.
  return Object.entries(shape.properties ?? {}).map(([key, child]) => ({
    ...toConfigVar(leavesOf(child, '', [key], required.has(key))[0]),
    name: key,
  }))
}

/** Values validated at startup (or on first `get()`), by prefix. */
const cached = new WeakMap<Settings<unknown>, unknown>()

/**
 * Define a typed configuration section read from env variables with a prefix.
 * Each key path becomes one variable: `pool.max` under `'DB'` is `DB_POOL_MAX`,
 * `maxConnections` is `DB_MAX_CONNECTIONS`. A list reads a comma-separated
 * value. `<NAME>_FILE` secrets work for every variable.
 *
 * ```ts
 * export const DbSettings = defineSettings('DB', z.object({
 *   url: z.string().url(),
 *   pool: z.object({ max: z.coerce.number().default(10) }).default({ max: 10 }),
 * }))
 *
 * @Service()
 * class Database {
 *   constructor(@Inject(DbSettings) private readonly db: SettingsOf<typeof DbSettings>) {}
 * }
 * ```
 *
 * Declare it where it's used — `bootstrap({ settings })`, a module's, adapter's
 * or plugin's `settings()` — and it is validated when the app starts (a
 * missing or invalid value fails startup, naming the variable) and injectable
 * by its token. Undeclared, `get()` validates it on first use. Values
 * come from the schema's coercion: use `z.coerce.number()`, and
 * `z.stringbool()` for booleans (`z.coerce.boolean()` reads `'false'` as true).
 */
export function defineSettings<S>(prefix: string, schema: S): Settings<InferSchemaOutput<S>> {
  return createSection(prefix, schema)
}

function createSection<S>(prefix: string, schema: S): Settings<InferSchemaOutput<S>> {
  type T = InferSchemaOutput<S>
  if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) {
    throw new Error(`defineSettings: prefix '${prefix}' must be UPPER_SNAKE_CASE, e.g. 'DB'`)
  }
  const wrapped = detectSchema(schema)
  // The env names come from the schema's shape, read through its JSON schema —
  // the one view every adapter (Zod, Valibot, Yup) provides.
  const shape = wrapped.toJsonSchema() as JsonShape
  if (!shape.properties) {
    throw new Error(
      `defineSettings('${prefix}'): the schema must be an object whose keys can be read ` +
        '(Zod, Valibot or Yup) — a bare Standard Schema has no shape to map to env names.',
    )
  }
  const leaves = leavesOf(shape, prefix)
  // `fooBar` and `foo_bar` would both read `DB_FOO_BAR` — one variable for two
  // settings that could never differ. Refuse it here, naming both paths.
  const seenEnv = new Map<string, string>()
  for (const leaf of leaves) {
    const path = leaf.path.join('.')
    const other = seenEnv.get(leaf.env)
    if (other !== undefined) {
      throw new Error(
        `defineSettings('${prefix}'): '${other}' and '${path}' both read ${leaf.env} — rename one`,
      )
    }
    seenEnv.set(leaf.env, path)
  }
  const envNames = leaves.map((leaf) => leaf.env)
  const byPath = new Map(leaves.map((leaf) => [leaf.path.join('.'), leaf.env]))

  const load = (env: NodeJS.ProcessEnv = process.env): T => {
    const source = readSecretFiles ? readSecretFiles(env, envNames) : env
    const input: Record<string, unknown> = {}
    for (const leaf of leaves) {
      const raw = source[leaf.env]
      if (raw === undefined) continue
      let target = input
      for (const key of leaf.path.slice(0, -1)) {
        target = (target[key] ??= {}) as Record<string, unknown>
      }
      target[leaf.path.at(-1)!] = leaf.list
        ? raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : raw
    }
    const result = wrapped.safeParse(input)
    if (result.success) return result.data as T
    const problems = result.issues.map((issue) => {
      const key = issue.path.join('.')
      // The variable to fix, not the schema path; a nested object that is
      // missing entirely names its prefix.
      const name =
        byPath.get(key) ?? [prefix, ...issue.path.map((p) => envSegment(String(p)))].join('_')
      return `  ${name}: ${issue.message}`
    })
    throw new Error(`Settings '${prefix}' are invalid:\n${problems.join('\n')}`)
  }

  const scopes = new Map<string, Settings<T>>()
  const settings: Settings<T> = Object.freeze({
    [INJECTION_TOKEN]: true as const,
    name: `Settings(${prefix})`,
    prefix,
    envNames,
    load,
    describe: () => leaves.map(toConfigVar),
    get: (): T => {
      // What injected code sees: the container's binding, which a module or a
      // test may have replaced. Before the app binds it, the validated env.
      const container = Container.getInstance()
      if (container.has(settings)) return container.resolve(settings) as T
      // Keyed by the section, not its prefix: two sections sharing a prefix
      // each parse their own schema.
      if (!cached.has(settings)) cached.set(settings, load())
      return cached.get(settings) as T
    },
    scoped: (name: string): Settings<T> => {
      const scopePrefix = `${name}_${prefix}`
      let scoped = scopes.get(scopePrefix)
      if (!scoped) {
        scoped = createSection(scopePrefix, schema) as Settings<T>
        scopes.set(scopePrefix, scoped)
      }
      return scoped
    },
  }) as Settings<T>
  return settings
}

/**
 * Validate the given sections — the ones the app declared — throwing once
 * with every problem, so a misconfigured deploy fails at startup with the
 * whole list. A section declared twice is loaded once; two different sections
 * with one prefix would read the same variables, and are refused.
 */
export function loadSettings(
  sections: Iterable<Settings<unknown>>,
  env: NodeJS.ProcessEnv = process.env,
  /**
   * Prefixes already taken, across calls — an app binds in two phases (app
   * sections, then modules') and a clash between them must still be refused.
   */
  byPrefix: Map<string, Settings<unknown>> = new Map(),
): Map<Settings<unknown>, unknown> {
  const values = new Map<Settings<unknown>, unknown>()
  const failures: string[] = []
  for (const section of sections) {
    if (values.has(section)) continue
    const other = byPrefix.get(section.prefix)
    // Already bound in an earlier phase: same section, nothing to do.
    if (other === section) continue
    if (other && other !== section) {
      failures.push(`Two different settings sections use the prefix '${section.prefix}'.`)
      continue
    }
    byPrefix.set(section.prefix, section)
    try {
      const value = section.load(env)
      values.set(section, value)
      // `get()` returns what the app started with.
      cached.set(section, value)
    } catch (err) {
      failures.push((err as Error).message)
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
  return values
}
