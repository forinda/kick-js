import type { ChatMessage } from '../types'

/**
 * Options for `createPrompt`.
 */
export interface CreatePromptOptions {
  /**
   * Short identifier used in logs, errors, and typegen output.
   * Defaults to `'prompt'` if not provided — give every non-trivial
   * template a real name so error messages point to the right place.
   */
  name?: string
  /**
   * Message role the rendered prompt produces. Defaults to `'user'`.
   * Set to `'system'` for persona / instruction prompts.
   */
  role?: ChatMessage['role']
  /**
   * How missing variables at render time are handled:
   *   - `'throw'` (default): throw a descriptive error. Catches bugs
   *     early and matches what most users expect.
   *   - `'warn'`: leave the placeholder as-is and log a warning via
   *     console.warn. Useful for templates with optional sections
   *     that the caller might not fill in.
   *   - `'silent'`: leave the placeholder as-is and don't warn.
   */
  onMissing?: 'throw' | 'warn' | 'silent'
}

/**
 * A reusable prompt template with `{{variable}}` placeholders and
 * a typed variables object at the render site.
 *
 * The type parameter `TVars` is a record of the variables the
 * template expects. Callers pass it explicitly:
 *
 * ```ts
 * const summarize = createPrompt<{ text: string; sentenceCount: number }>(
 *   'Summarize the following in {{sentenceCount}} sentences:\n\n{{text}}',
 *   { name: 'summarize' },
 * )
 *
 * const msg = summarize.render({ text: 'Long article...', sentenceCount: 3 })
 * // → { role: 'user', content: 'Summarize the following in 3 sentences:\n\nLong article...' }
 * ```
 *
 * TypeScript catches missing or mistyped variables at compile time:
 *
 * ```ts
 * summarize.render({ text: 'x' })           // ✗ missing sentenceCount
 * summarize.render({ text: 'x', count: 3 }) // ✗ wrong key name
 * ```
 *
 * @remarks
 * Runtime-only in v0 — the type parameter is opt-in and has to be
 * provided explicitly. Workstream 5 adds a `kick typegen` pass that
 * scans `createPrompt` call sites and generates the TVars shape
 * automatically, so you can write `createPrompt('...')` and get
 * the types for free.
 */
export class Prompt<TVars extends Record<string, unknown> = Record<string, unknown>> {
  readonly name: string
  readonly role: ChatMessage['role']
  private readonly template: string
  private readonly onMissing: 'throw' | 'warn' | 'silent'

  constructor(template: string, options: CreatePromptOptions = {}) {
    if (typeof template !== 'string') {
      throw new Error('createPrompt: template must be a string')
    }
    this.template = template
    this.name = options.name ?? 'prompt'
    this.role = options.role ?? 'user'
    this.onMissing = options.onMissing ?? 'throw'
  }

  /**
   * Substitute variables into the template and return a
   * ready-to-use `ChatMessage`.
   *
   * Placeholder syntax is `{{name}}` — double curly braces around
   * the variable name. Whitespace inside the braces is ignored
   * (`{{ name }}` works too). Unknown variables in the template
   * are left as-is, so Markdown or code blocks that happen to use
   * `{{` for their own reasons don't break.
   *
   * @throws If `onMissing === 'throw'` and a required variable is absent
   */
  render(vars: TVars): ChatMessage {
    return {
      role: this.role,
      content: this.renderString(vars),
    }
  }

  /**
   * Same as `render` but returns the raw string instead of wrapping
   * it in a `ChatMessage`. Useful for building composite messages
   * where several templates contribute to a single string.
   */
  renderString(vars: TVars): string {
    return this.template.replace(
      /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g,
      (_match, key: string) => {
        if (!(key in vars)) {
          return this.handleMissing(key, _match)
        }
        const value = (vars as Record<string, unknown>)[key]
        if (value === undefined || value === null) {
          return this.handleMissing(key, _match)
        }
        return String(value)
      },
    )
  }

  /** Return the raw template string. Useful for debugging and snapshot tests. */
  getTemplate(): string {
    return this.template
  }

  /**
   * Return the set of placeholder names the template references.
   *
   * Mostly useful for testing and for tooling that wants to show
   * users what variables a prompt takes. Not a substitute for the
   * compile-time type check — templates can always reference
   * variables that aren't in TVars; this helper reads the string,
   * not the type.
   */
  getPlaceholders(): string[] {
    const matches = this.template.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g)
    const names = new Set<string>()
    for (const m of matches) {
      const name = m[1]
      if (name) names.add(name)
    }
    return [...names]
  }

  private handleMissing(key: string, original: string): string {
    if (this.onMissing === 'throw') {
      throw new Error(`Prompt(${this.name}): variable "${key}" is missing from the render call`)
    }
    if (this.onMissing === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(
        `Prompt(${this.name}): variable "${key}" is missing from the render call; leaving placeholder`,
      )
    }
    return original
  }
}

/**
 * Construct a reusable prompt template.
 *
 * Thin factory for the `Prompt` class — keeps call sites short and
 * matches the naming convention of other kickjs-ai factories
 * (`createToken`, etc.). Use the class form directly if you need
 * subclassing or custom rendering logic.
 *
 * @example
 * ```ts
 * import { createPrompt } from '@forinda/kickjs-ai'
 *
 * const persona = createPrompt<{ name: string; tone: string }>(
 *   'You are {{name}}, a {{tone}} assistant.',
 *   { role: 'system', name: 'persona' },
 * )
 *
 * const msg = persona.render({ name: 'Claude', tone: 'concise' })
 * ```
 */
export function createPrompt<TVars extends Record<string, unknown> = Record<string, unknown>>(
  template: string,
  options: CreatePromptOptions = {},
): Prompt<TVars> {
  return new Prompt<TVars>(template, options)
}
