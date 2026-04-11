/**
 * LLM fallback for `kick explain --ai`.
 *
 * When the pattern-based known-issues registry doesn't match, this
 * module asks a real LLM provider to produce a structured diagnosis
 * in the same shape. The CLI prints the result through the same
 * formatter as a known-issue match, so the user sees a uniform
 * output regardless of which path produced the answer.
 *
 * `@forinda/kickjs-ai` is imported dynamically: users who don't use
 * any AI features never pay the dependency cost, and if the package
 * is missing the CLI prints a friendly "run `kick add ai`" message
 * instead of crashing. Same graceful-degradation pattern as
 * `kick dev`'s handling of `vite`.
 *
 * Provider selection and credentials:
 *   - Default provider is OpenAI via `OPENAI_API_KEY`
 *   - `--model` on the CLI overrides the default model
 *   - Providers other than OpenAI ship in later workstreams; the
 *     function signature is ready to accept them
 *
 * @module @forinda/kickjs-cli/explain/ai-fallback
 */

import type { Diagnosis } from './known-issues'

/** Options for the AI fallback call. */
export interface AskAiOptions {
  /** The error text the user wants explained. */
  input: string
  /** Model override. Defaults to whatever the provider picks. */
  model?: string
  /**
   * Provider key — only `'openai'` is wired in this commit. Anthropic,
   * Google, and Ollama slot in once their provider classes land.
   */
  provider?: 'openai'
  /** Project root, so the fallback can mention file paths the user recognizes. */
  cwd?: string
}

/**
 * One of three discriminated results from the fallback:
 *   - `ok`: the LLM returned a valid structured diagnosis
 *   - `unavailable`: AI package not installed, or API key missing
 *   - `error`: the request went through but failed (bad JSON, 4xx, etc.)
 *
 * The CLI inspects the kind and prints the appropriate message — the
 * function itself never throws on expected failure modes.
 */
export type AskAiResult =
  | { kind: 'ok'; diagnosis: Diagnosis }
  | { kind: 'unavailable'; reason: string; suggestion: string }
  | { kind: 'error'; message: string }

/**
 * Ask the configured LLM for a diagnosis of `options.input`.
 *
 * Returns a discriminated result; callers should never assume the
 * LLM was reachable or produced valid output. The function catches
 * every expected failure mode and maps it to a friendly `unavailable`
 * or `error` result — the CLI can then decide how to present it.
 */
export async function askAi(options: AskAiOptions): Promise<AskAiResult> {
  const provider = options.provider ?? 'openai'

  // Check credentials before importing the package. Avoids the
  // noisy "can't find @forinda/kickjs-ai" error for the very common
  // case where the user forgot to set OPENAI_API_KEY.
  const apiKey = process.env.OPENAI_API_KEY
  if (provider === 'openai' && !apiKey) {
    return {
      kind: 'unavailable',
      reason: 'OPENAI_API_KEY environment variable is not set',
      suggestion:
        'Set OPENAI_API_KEY in your shell, e.g.\n' +
        '  export OPENAI_API_KEY="sk-..."\n' +
        '\n' +
        'Then re-run `kick explain --ai "<your error>"`.',
    }
  }

  // Dynamically import @forinda/kickjs-ai so users who never opt
  // into AI features don't pay the dependency cost. If the package
  // isn't installed, surface install instructions rather than
  // letting Node's module resolution error bubble up.
  let aiModule: typeof import('@forinda/kickjs-ai')
  try {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    aiModule = (await import('@forinda/kickjs-ai')) as typeof import('@forinda/kickjs-ai')
  } catch {
    return {
      kind: 'unavailable',
      reason: '@forinda/kickjs-ai is not installed',
      suggestion:
        'Install the AI package to enable the LLM fallback:\n' +
        '  kick add ai\n' +
        '\n' +
        'Or manually:\n' +
        '  pnpm add @forinda/kickjs-ai',
    }
  }

  const { OpenAIProvider } = aiModule
  const instance = new OpenAIProvider({
    apiKey: apiKey as string,
    defaultChatModel: options.model ?? 'gpt-4o-mini',
  })

  const systemPrompt = buildSystemPrompt(options.cwd)
  const userPrompt = `Error or stack trace:\n\n${options.input.trim()}`

  try {
    const response = await instance.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    const diagnosis = parseDiagnosisFromResponse(response.content)
    if (!diagnosis) {
      return {
        kind: 'error',
        message:
          'The LLM responded but the payload was not valid JSON in the expected shape. ' +
          'Try again, or file an issue with the error text.',
      }
    }
    return { kind: 'ok', diagnosis }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { kind: 'error', message: `LLM request failed: ${message}` }
  }
}

// ── Prompt and parsing ────────────────────────────────────────────────────

/**
 * Build the system prompt that tells the LLM what KickJS is and how
 * to structure its response. The prompt is deliberately prescriptive:
 * the caller needs a JSON payload it can render via the same formatter
 * the known-issues path uses, so freeform text doesn't work.
 *
 * Keep this prompt short — every token counts at inference time and
 * the CLI is often called interactively.
 */
function buildSystemPrompt(cwd?: string): string {
  return [
    'You are a diagnostic assistant for KickJS, a decorator-driven Node.js',
    'framework built on Express 5 and TypeScript. KickJS projects use:',
    '  - @Controller, @Get, @Post, @Autowired, @Service, @Value decorators',
    '  - An AppModule interface with a routes() method (NOT a @Module decorator)',
    '  - Zod schemas as both runtime validators and OpenAPI sources',
    "  - Ctx<KickRoutes.ControllerName['method']> for typed request context",
    '  - src/config/index.ts with defineEnv/loadEnv for env schema',
    '  - A side-effect `import "./config"` in src/index.ts to register the schema',
    '  - Container.reset() in beforeEach for DI test isolation',
    '',
    'When the user gives you an error message or stack trace, produce a',
    'structured diagnosis that helps them fix the bug. You MUST respond',
    'with a single JSON object (no surrounding prose, no markdown fences)',
    'matching this shape:',
    '',
    '{',
    '  "id": "<kebab-case-identifier>",',
    '  "title": "<one-line problem summary>",',
    '  "explanation": "<multi-line explanation of what is wrong>",',
    '  "fix": "<multi-line instructions for fixing the problem>",',
    '  "codeBefore": "<optional: broken code snippet>",',
    '  "codeAfter": "<optional: corrected code snippet>",',
    '  "docs": "<optional: KickJS doc URL that discusses this topic>"',
    '}',
    '',
    'The KickJS docs live at https://forinda.github.io/kick-js/ — prefer',
    'that domain for any doc links you suggest.',
    cwd ? `The project is located at ${cwd}.` : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

/**
 * Extract a `Diagnosis` object from the LLM response content.
 *
 * Tries three strategies in order:
 *   1. Parse the whole content as JSON directly
 *   2. Strip a surrounding markdown fence (```json ... ```)
 *   3. Find the first balanced `{ ... }` block and parse that
 *
 * Returns null if none of the strategies produce a valid object with
 * at least the required fields (id, title, explanation, fix).
 */
function parseDiagnosisFromResponse(content: string): Diagnosis | null {
  const attempts = [content, stripMarkdownFence(content), extractFirstJsonObject(content)].filter(
    (s): s is string => s !== null,
  )

  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt)
      if (isValidDiagnosis(parsed)) {
        return parsed
      }
    } catch {
      continue
    }
  }
  return null
}

function stripMarkdownFence(text: string): string | null {
  const match = text.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  return match ? (match[1]?.trim() ?? null) : null
}

function extractFirstJsonObject(text: string): string | null {
  // Walk forward counting braces; return the first balanced block.
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function isValidDiagnosis(value: unknown): value is Diagnosis {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.explanation === 'string' &&
    typeof v.fix === 'string'
  )
}
