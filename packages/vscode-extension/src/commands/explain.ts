/**
 * `KickJS: Explain Error…` — runs `kick explain --json` on a pasted error
 * message and opens the diagnosis as a Markdown preview.
 *
 * Unlike the other palette commands this does NOT go through the shared
 * terminal: the input is free text, and pasting it into a shell line would
 * need quoting that is correct for every shell (POSIX, PowerShell, cmd).
 * Instead the CLI runs via `execFile` with an argument array — no shell, no
 * quoting — and the JSON result is rendered here.
 *
 * @module @forinda/kickjs-vscode/commands/explain
 */

import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** `kick explain --json` output (see packages/cli/src/commands/explain.ts). */
export interface ExplainResult {
  matched: boolean
  confidence?: number
  source?: 'ai'
  diagnosis?: {
    id?: string
    title: string
    explanation: string
    fix: string
    codeBefore?: string
    codeAfter?: string
    docs?: string
  }
}

/**
 * Find the project's installed CLI entry by walking up from `root` —
 * `@forinda/kickjs-cli` exports only `.`, so `require.resolve` cannot reach
 * `bin.js` through the exports map.
 */
export function findCliBin(root: string): string | undefined {
  let dir = root
  for (;;) {
    const bin = join(dir, 'node_modules', '@forinda', 'kickjs-cli', 'bin.js')
    if (existsSync(bin)) return bin
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * Arguments for `node <bin> …`. The message rides in a single
 * `--message=<text>` element so a message that starts with `-` can't be
 * parsed as a flag.
 */
export function explainArgs(bin: string, message: string): string[] {
  return [bin, 'explain', '--json', `--message=${message}`]
}

/** Render a result as Markdown for the preview. */
export function formatExplanation(input: string, result: ExplainResult): string {
  const quoted = input
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
  if (!result.matched || !result.diagnosis) {
    return [
      '# No known cause',
      '',
      quoted,
      '',
      '`kick explain` has no known issue matching this message. Try a longer excerpt of the error, or run `kick explain --ai` in a terminal for an LLM-based answer (requires `@forinda/kickjs-ai`).',
      '',
    ].join('\n')
  }
  const d = result.diagnosis
  const lines = [`# ${d.title}`, '', quoted, '']
  if (result.confidence !== undefined) lines.push(`_Confidence: ${result.confidence}%_`, '')
  lines.push('## Why', '', d.explanation, '', '## Fix', '', d.fix, '')
  if (d.codeBefore) lines.push('**Before**', '', '```ts', d.codeBefore, '```', '')
  if (d.codeAfter) lines.push('**After**', '', '```ts', d.codeAfter, '```', '')
  if (d.docs) lines.push(`[Read more](${d.docs})`, '')
  return lines.join('\n')
}

export function registerExplainCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('kickjs.explain', async () => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    if (!root) {
      vscode.window.showErrorMessage('KickJS: open a KickJS project folder first.')
      return
    }
    const bin = findCliBin(root)
    if (!bin) {
      vscode.window.showErrorMessage(
        'KickJS: @forinda/kickjs-cli is not installed in this project — run `kick explain` from a terminal instead.',
      )
      return
    }

    // Prefill with the editor selection (a copied stack trace, a log line).
    const editor = vscode.window.activeTextEditor
    const selection =
      editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : ''
    const message = await vscode.window.showInputBox({
      title: 'KickJS: explain error',
      prompt: 'Paste the error message (or select it in the editor first)',
      value: selection,
      validateInput: (v) => (v.trim() ? null : 'Paste an error message'),
    })
    if (!message) return

    const stdout = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'KickJS: explaining…' },
      () =>
        new Promise<string>((resolve) => {
          // Exit code 2 means "no match" and still prints JSON — read stdout
          // regardless of the exit status.
          execFile(
            'node',
            explainArgs(bin, message),
            { cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024 },
            (_err, out) => resolve(out ?? ''),
          )
        }),
    )

    let result: ExplainResult
    try {
      result = JSON.parse(stdout) as ExplainResult
    } catch {
      vscode.window.showErrorMessage(
        'KickJS: `kick explain` returned no result — is the installed CLI up to date?',
      )
      return
    }

    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: formatExplanation(message, result),
    })
    await vscode.commands.executeCommand('markdown.showPreview', doc.uri)
  })
}
