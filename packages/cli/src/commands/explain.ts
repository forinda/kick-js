import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { findBestMatch, type Diagnosis, type ExplainContext } from '../explain/known-issues'
import { askAi, type AskAiResult } from '../explain/ai-fallback'

/**
 * `kick explain` — explain a KickJS error and suggest a fix.
 *
 * The command takes an error message (positional arg, --message flag,
 * or stdin), runs it through a registry of known KickJS pitfalls, and
 * prints the highest-confidence diagnosis with a code fix and a doc
 * link. If no matcher hits, it prints a "no match" message — the
 * --ai flag (planned) will fall back to an LLM call against the
 * registered AiProvider.
 *
 * The known-issues registry lives in src/explain/known-issues.ts and
 * is the single source of truth for KickJS-specific advice. Adding a
 * new entry takes ~30 lines and gives every user a permanent fix path.
 *
 * @example
 * ```bash
 * # As a positional arg
 * kick explain "config.get('DATABASE_URL') returned undefined"
 *
 * # Via stdin (pipe a stack trace)
 * pnpm test 2>&1 | kick explain
 *
 * # Via --message flag
 * kick explain --message "Reflect.getMetadata is not a function"
 * ```
 */
export function registerExplainCommand(program: Command): void {
  program
    .command('explain [message]')
    .description('Explain a KickJS error and suggest a fix')
    .option('-m, --message <text>', 'Error message to explain (alternative to positional arg)')
    .option('--ai', 'Fall back to LLM if no known-issue matches (requires @forinda/kickjs-ai)')
    .option('--model <name>', 'Model name for the --ai fallback', 'gpt-4o-mini')
    .option('--json', 'Output the diagnosis as JSON for tooling integration')
    .action(async (positional: string | undefined, opts: ExplainOptions) => {
      const input = await resolveInput(positional, opts.message)

      if (!input || input.trim().length === 0) {
        process.stderr.write(
          'Error: no input provided.\n' +
            '\n' +
            'Pass a message as a positional arg, --message flag, or pipe via stdin:\n' +
            '  kick explain "config.get returned undefined"\n' +
            '  pnpm test 2>&1 | kick explain\n',
        )
        process.exit(1)
      }

      const ctx = buildExplainContext()
      const match = findBestMatch(input, ctx)

      if (opts.json && match) {
        process.stdout.write(JSON.stringify({ matched: true, ...match }, null, 2) + '\n')
        return
      }

      if (match) {
        printDiagnosis(input, match.diagnosis, match.confidence)
        return
      }

      // No local match. If --ai was set, try the LLM fallback; otherwise
      // print the "no match" guidance and exit with code 2 so callers can
      // detect "I have no answer" programmatically.
      if (!opts.ai) {
        if (opts.json) {
          process.stdout.write(JSON.stringify({ matched: false }, null, 2) + '\n')
          process.exit(2)
        }
        printNoMatch(input, false)
        process.exit(2)
      }

      const result = await askAi({
        input,
        model: opts.model,
        cwd: ctx.cwd,
      })

      if (opts.json) {
        process.stdout.write(JSON.stringify(aiResultToJson(result), null, 2) + '\n')
        process.exit(result.kind === 'ok' ? 0 : 2)
      }

      printAiResult(input, result)
      process.exit(result.kind === 'ok' ? 0 : 2)
    })
}

interface ExplainOptions {
  message?: string
  ai?: boolean
  model?: string
  json?: boolean
}

/** Serialize an AskAiResult for `--json` output. */
function aiResultToJson(result: AskAiResult): Record<string, unknown> {
  if (result.kind === 'ok') {
    return { matched: true, source: 'ai', diagnosis: result.diagnosis }
  }
  if (result.kind === 'unavailable') {
    return { matched: false, aiUnavailable: true, reason: result.reason }
  }
  return { matched: false, aiError: true, error: result.message }
}

/** Render an AskAiResult to stdout using the same formatting as local matches. */
function printAiResult(input: string, result: AskAiResult): void {
  if (result.kind === 'ok') {
    // Confidence for the AI path is not numeric — the LLM doesn't
    // surface a probability we can trust. Use a fixed label that
    // clearly marks the answer as AI-generated rather than pattern-
    // matched, so users know to sanity-check it.
    printDiagnosis(input, result.diagnosis, -1, /* aiLabel */ true)
    return
  }
  if (result.kind === 'unavailable') {
    process.stdout.write(`\n  Explaining: ${truncate(input.trim(), 200)}\n\n`)
    process.stdout.write(`  AI fallback unavailable: ${result.reason}\n\n`)
    process.stdout.write(`${indent(result.suggestion, '  ')}\n\n`)
    return
  }
  process.stdout.write(`\n  Explaining: ${truncate(input.trim(), 200)}\n\n`)
  process.stdout.write(`  AI fallback error: ${result.message}\n\n`)
}

// ── Input resolution ──────────────────────────────────────────────────────

/**
 * Resolve the error text from positional arg, --message flag, or stdin.
 *
 * Precedence: positional > flag > stdin. We only read stdin if neither
 * of the first two were provided AND stdin is not a TTY (i.e. something
 * is being piped in). Reading from a real TTY would hang waiting for
 * the user to type, which is never what they want.
 */
async function resolveInput(positional?: string, flag?: string): Promise<string> {
  if (positional && positional.trim().length > 0) return positional
  if (flag && flag.trim().length > 0) return flag
  if (process.stdin.isTTY) return ''
  return readStdinAll()
}

function readStdinAll(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk
    })
    process.stdin.on('end', () => resolve(buffer))
    process.stdin.on('error', reject)
  })
}

// ── Project context ───────────────────────────────────────────────────────

/**
 * Build a small context object the matchers can use to check project
 * state — e.g. "does this project have a src/config/index.ts?".
 *
 * Kept intentionally minimal to avoid pulling the full kick.config
 * loader into a fast-path command. Matchers should treat this as
 * best-effort and degrade gracefully when ctx is undefined.
 */
function buildExplainContext(): ExplainContext {
  const cwd = process.cwd()
  return {
    cwd,
    hasFile: (path: string) => existsSync(resolve(cwd, path)),
  }
}

// ── Output ────────────────────────────────────────────────────────────────

function printDiagnosis(input: string, d: Diagnosis, confidence: number, aiLabel = false): void {
  const inputSnippet = truncate(input.trim(), 200)
  const label = aiLabel ? 'AI-generated — verify before applying' : labelConfidence(confidence)

  process.stdout.write(`\n  Explaining: ${inputSnippet}\n`)
  process.stdout.write(`\n  Match: ${d.id}  (${label})\n`)
  process.stdout.write(`  Title: ${d.title}\n`)
  process.stdout.write(`\n  Diagnosis:\n${indent(d.explanation, '    ')}\n`)
  process.stdout.write(`\n  Fix:\n${indent(d.fix, '    ')}\n`)

  if (d.codeBefore) {
    process.stdout.write(`\n  Before:\n${indent(d.codeBefore, '      ')}\n`)
  }
  if (d.codeAfter) {
    process.stdout.write(`\n  After:\n${indent(d.codeAfter, '      ')}\n`)
  }
  if (d.docs) {
    process.stdout.write(`\n  Docs: ${d.docs}\n`)
  }
  process.stdout.write('\n')
}

function printNoMatch(input: string, aiRequested?: boolean): void {
  const snippet = truncate(input.trim(), 200)
  process.stdout.write(`\n  Explaining: ${snippet}\n\n`)
  if (aiRequested) {
    process.stdout.write(
      '  No known-issue matched, and --ai fallback is not yet wired.\n' +
        '  When @forinda/kickjs-ai ships its provider implementations,\n' +
        '  this command will call the configured LLM with the error +\n' +
        '  project context and return a structured fix.\n\n',
    )
  } else {
    process.stdout.write(
      '  No known-issue matched. Things you can try:\n' +
        '\n' +
        '    1. Check the framework docs for the error keywords:\n' +
        '       https://forinda.github.io/kick-js/\n' +
        '\n' +
        '    2. Re-run with --ai to fall back to an LLM (requires\n' +
        '       @forinda/kickjs-ai with a configured provider):\n' +
        '       kick explain --ai "<your error>"\n' +
        '\n' +
        '    3. File an issue with the error text:\n' +
        '       https://github.com/forinda/kick-js/issues/new\n\n',
    )
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

function labelConfidence(score: number): string {
  if (score >= 90) return 'high confidence'
  if (score >= 70) return 'good match'
  if (score >= 50) return 'medium confidence'
  return 'low confidence — verify manually'
}
