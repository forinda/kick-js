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
}

/** The value type of a section: `SettingsOf<typeof DbSettings>`. */
export type SettingsOf<S> = S extends Settings<infer T> ? T : never

interface Leaf {
  path: string[]
  env: string
  list: boolean
}

/** The part of a JSON schema the env mapping reads. */
interface JsonShape {
  type?: string | string[]
  properties?: Record<string, JsonShape>
}

/** `maxConnections` → `MAX_CONNECTIONS`. */
const envSegment = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()

function leavesOf(shape: JsonShape, prefix: string, path: string[] = []): Leaf[] {
  if (shape.properties) {
    return Object.entries(shape.properties).flatMap(([key, child]) =>
      leavesOf(child, prefix, [...path, key]),
    )
  }
  const types = Array.isArray(shape.type) ? shape.type : [shape.type]
  return [
    {
      path,
      env: [prefix, ...path.map(envSegment)].join('_'),
      list: types.includes('array'),
    },
  ]
}

/**
 * All sections defined in this process, by prefix, validated together at
 * startup. Keyed by prefix so an HMR re-evaluation replaces its section
 * instead of adding a second one.
 */
const defined = new Map<string, Settings<unknown>>()
/** Values validated at startup (or on first `get()`), by prefix. */
const cached = new Map<string, unknown>()

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
 * Every section is validated when the app starts — a missing or invalid value
 * fails startup, naming the variable — and is injectable by its token. Values
 * come from the schema's coercion: use `z.coerce.number()`, and
 * `z.stringbool()` for booleans (`z.coerce.boolean()` reads `'false'` as true).
 */
export function defineSettings<S>(prefix: string, schema: S): Settings<InferSchemaOutput<S>> {
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

  const settings: Settings<T> = Object.freeze({
    [INJECTION_TOKEN]: true as const,
    name: `Settings(${prefix})`,
    prefix,
    envNames,
    load,
    get: (): T => {
      // What injected code sees: the container's binding, which a module or a
      // test may have replaced. Before the app binds it, the validated env.
      const container = Container.getInstance()
      if (container.has(settings)) return container.resolve(settings) as T
      if (!cached.has(prefix)) cached.set(prefix, load())
      return cached.get(prefix) as T
    },
  }) as Settings<T>
  defined.set(prefix, settings as Settings<unknown>)
  return settings
}

/**
 * Load every defined section, throwing once with all their problems — so a
 * misconfigured deploy fails at startup with the whole list, not one at a
 * time. Returns each section's value, for binding into the container.
 */
export function loadAllSettings(
  env: NodeJS.ProcessEnv = process.env,
): Map<Settings<unknown>, unknown> {
  const values = new Map<Settings<unknown>, unknown>()
  const failures: string[] = []
  for (const settings of defined.values()) {
    try {
      const value = settings.load(env)
      values.set(settings, value)
      // `get()` returns what the app started with.
      cached.set(settings.prefix, value)
    } catch (err) {
      failures.push((err as Error).message)
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'))
  return values
}
