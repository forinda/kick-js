/**
 * Plugin generator API per architecture.md §21.2.3 — lets first-party
 * AND third-party packages ship `kick g <name>` scaffolders the same
 * way the framework's built-in generators do.
 *
 * Plugins declare a discovery file in their `package.json`:
 *
 * ```json
 * {
 *   "name": "@my-org/kickjs-cqrs",
 *   "kickjs": { "generators": "./dist/generators.js" }
 * }
 * ```
 *
 * The discovery file exports a typed manifest:
 *
 * ```ts
 * import { defineGenerator } from '@forinda/kickjs-cli'
 *
 * export default [
 *   defineGenerator({
 *     name: 'command',
 *     description: 'Generate a CQRS command + handler',
 *     args: [{ name: 'name', required: true }],
 *     files: (ctx) => [
 *       {
 *         path: `src/modules/${ctx.kebab}/commands/create-${ctx.kebab}.command.ts`,
 *         content: `// generated command for ${ctx.pascal}`,
 *       },
 *     ],
 *   }),
 * ]
 * ```
 *
 * `kick g command Order` then dispatches against the registered
 * generator and writes the returned files relative to `cwd`.
 */

/**
 * Resolved naming variants + project context handed to a generator's
 * `files()` factory. Keys mirror `TemplateContext` so first-party
 * generators that rely on the same shape can be migrated to plugin
 * generators without rewriting their templates.
 */
export interface GeneratorContext {
  /** Raw name passed on the command line (`kick g resolver UserPost` → `'UserPost'`). */
  name: string
  /** PascalCase form (`UserPost`). */
  pascal: string
  /** kebab-case form (`user-post`). */
  kebab: string
  /** camelCase form (`userPost`). */
  camel: string
  /** snake_case form (`user_post`). */
  snake: string
  /** Pluralized PascalCase (`UserPosts`) — present when the project enables `pluralize`. */
  pluralPascal?: string
  /** Pluralized kebab-case (`user-posts`). */
  pluralKebab?: string
  /** Pluralized camelCase (`userPosts`). */
  pluralCamel?: string
  /** Modules directory from `kick.config.ts` (default `'src/modules'`). */
  modulesDir: string
  /** Working directory for the generator — usually `process.cwd()`. */
  cwd: string
  /** Positional arguments passed AFTER the name (e.g. `kick g command Order extra1 extra2` → `['extra1', 'extra2']`). */
  args: string[]
  /** Flag values from the command line — booleans for switches, strings for `--key value`. */
  flags: Record<string, string | boolean>
}

/** A single output file the generator wants written. */
export interface GeneratorFile {
  /**
   * Output path. Relative paths resolve against `ctx.cwd`; absolute
   * paths are used as-is. Parent directories are created automatically.
   */
  path: string
  /** File contents written verbatim (UTF-8). */
  content: string
}

/** CLI argument descriptor surfaced in `kick g --list` help. */
export interface GeneratorArg {
  name: string
  required?: boolean
  description?: string
}

/** CLI flag descriptor — boolean unless `takesValue: true`. */
export interface GeneratorFlag {
  name: string
  alias?: string
  description?: string
  takesValue?: boolean
}

/**
 * Spec returned by {@link defineGenerator}. Plugin discovery files
 * export `GeneratorSpec[]` as their default export.
 */
export interface GeneratorSpec {
  /**
   * Dispatch name — `kick g <name>` looks for an exact match against
   * this string after the built-in generators are checked.
   */
  name: string
  /** Description shown in `kick g --list` and `--help`. */
  description: string
  /** Optional argument descriptors — informational, surfaced in help output. */
  args?: readonly GeneratorArg[]
  /** Optional flag descriptors — informational, surfaced in help output. */
  flags?: readonly GeneratorFlag[]
  /** Build the output files for one invocation. May return a Promise. */
  files(ctx: GeneratorContext): GeneratorFile[] | Promise<GeneratorFile[]>
}

/**
 * Identity factory — returns the spec verbatim. Exists for type
 * inference and forward-compatibility (future fields can be added with
 * defaults).
 *
 * @example
 * ```ts
 * import { defineGenerator } from '@forinda/kickjs-cli'
 *
 * export default [
 *   defineGenerator({
 *     name: 'command',
 *     description: 'Generate a CQRS command + handler',
 *     files: (ctx) => [
 *       {
 *         path: `src/modules/${ctx.kebab}/commands/${ctx.kebab}.command.ts`,
 *         content: `// command for ${ctx.pascal}`,
 *       },
 *     ],
 *   }),
 * ]
 * ```
 */
export function defineGenerator(spec: GeneratorSpec): GeneratorSpec {
  return spec
}
