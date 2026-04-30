/**
 * Palette wrappers around the `kick` CLI — `dev`, `build`, `start`, the
 * generators (module/controller/service/scaffold), `add`, and `rm`.
 *
 * Each command writes a fully-formed `kick <subcommand>` line into a
 * shared "KickJS" terminal so the user sees the exit + output the same
 * way they would running it by hand. We deliberately do NOT exec the
 * CLI from the extension host: stdout would land in an output channel
 * with no scroll-back, no colour, and no easy way to Ctrl-C a long-
 * running `dev` server.
 *
 * The package manager is resolved from the workspace's lockfile (pnpm
 * → yarn → bun → npm fallback) so the command line matches how the
 * adopter normally invokes scripts. `npx kick` is the universal escape
 * hatch when no lockfile is present.
 *
 * @module @forinda/kickjs-vscode/commands/kick
 */

import * as vscode from 'vscode'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const TERMINAL_NAME = 'KickJS'

export function registerKickCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('kickjs.dev', () => runKick('dev')),
    vscode.commands.registerCommand('kickjs.build', () => runKick('build')),
    vscode.commands.registerCommand('kickjs.start', () => runKick('start')),

    vscode.commands.registerCommand('kickjs.generateModule', () =>
      promptAndRunGenerator('module', 'module name (kebab-case)', 'users'),
    ),
    vscode.commands.registerCommand('kickjs.generateController', () =>
      promptAndRunGenerator('controller', 'controller name', 'users'),
    ),
    vscode.commands.registerCommand('kickjs.generateService', () =>
      promptAndRunGenerator('service', 'service name', 'users'),
    ),
    vscode.commands.registerCommand('kickjs.generateScaffold', async () => {
      const name = await vscode.window.showInputBox({
        title: 'KickJS: scaffold name',
        prompt: 'Module name to scaffold (creates module + controller + service + repo)',
        placeHolder: 'users',
        validateInput: validateName,
      })
      if (!name) return
      const fields = await vscode.window.showInputBox({
        title: 'KickJS: scaffold fields',
        prompt: 'Optional space-separated `name:type` pairs (leave empty to skip)',
        placeHolder: 'name:string email:string age:number',
      })
      if (fields === undefined) return
      const argv = fields.trim() ? `scaffold ${name} ${fields}` : `scaffold ${name}`
      runKick(`g ${argv}`)
    }),

    vscode.commands.registerCommand('kickjs.addPackage', async () => {
      const pkg = await pickAddPackage()
      if (!pkg) return
      runKick(`add ${pkg}`)
    }),

    vscode.commands.registerCommand('kickjs.removeModule', async () => {
      const name = await vscode.window.showInputBox({
        title: 'KickJS: remove module',
        prompt: 'Module name to remove (deletes the module directory + cleans index.ts)',
        validateInput: validateName,
      })
      if (!name) return
      const confirm = await vscode.window.showWarningMessage(
        `Remove module "${name}"? This deletes its directory and updates the modules index.`,
        { modal: true },
        'Remove',
      )
      if (confirm !== 'Remove') return
      runKick(`rm module ${name}`)
    }),

    // ── Agent surface ───────────────────────────────────────────────
    // Three commands that wire the project into the AI-agent ecosystem
    // (Claude Code, Cursor, Copilot agents, etc.):
    //   - regenerate the agent docs (AGENTS.md / CLAUDE.md / skills)
    //   - boot the MCP server so an agent can call the project's
    //     decorated controllers as tools
    //   - scaffold an MCP config file under .claude/ for one-click
    //     attach from Claude Code.
    vscode.commands.registerCommand('kickjs.generateAgentDocs', () =>
      pickAgentDocsScope().then((only) => {
        if (!only) return
        runKick(only === 'all' ? 'g agents' : `g agents --only ${only}`)
      }),
    ),
    vscode.commands.registerCommand('kickjs.mcpStart', () => runKick('mcp start')),
    vscode.commands.registerCommand('kickjs.mcpInit', () => runKick('mcp init')),
  ]
}

async function pickAgentDocsScope(): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'all', description: 'AGENTS.md + CLAUDE.md + kickjs-skills.md (default)' },
      { label: 'agents', description: 'AGENTS.md only' },
      { label: 'claude', description: 'CLAUDE.md only' },
      { label: 'skills', description: 'kickjs-skills.md only' },
      { label: 'both', description: 'agents + claude (skip skills)' },
    ],
    {
      title: 'KickJS: regenerate agent docs',
      placeHolder: 'Pick which docs to regenerate',
    },
  )
  return choice?.label
}

async function promptAndRunGenerator(
  kind: 'module' | 'controller' | 'service',
  prompt: string,
  placeholder: string,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: `KickJS: generate ${kind}`,
    prompt,
    placeHolder: placeholder,
    validateInput: validateName,
  })
  if (!name) return
  runKick(`g ${kind} ${name}`)
}

/**
 * Curated list of `kick add` targets — kept in sync with
 * `PACKAGE_REGISTRY` in `packages/cli/src/commands/add.ts` so the
 * palette only offers packages that actually publish.
 *
 * Deprecated packages from the BYO-recipes phased deprecation
 * (multi-tenant, otel, notifications, mailer, cron, graphql, cache)
 * are intentionally absent — adopters who still want them can wire a
 * `defineAdapter()` / `definePlugin()` recipe in their own codebase.
 */
function addPackageOptions(): vscode.QuickPickItem[] {
  return [
    { label: 'auth', description: 'JWT, API key, custom strategies' },
    { label: 'swagger', description: 'OpenAPI spec + Swagger UI + ReDoc' },
    { label: 'ws', description: '@WsController decorators (socket.io)' },
    { label: 'queue', description: 'Queue adapter (BullMQ / RabbitMQ / Kafka)' },
    { label: 'queue:bullmq', description: 'Queue + BullMQ + Redis peers' },
    { label: 'queue:rabbitmq', description: 'Queue + RabbitMQ peer (amqplib)' },
    { label: 'queue:kafka', description: 'Queue + Kafka peer (kafkajs)' },
    { label: 'devtools', description: 'Debug dashboard at /_debug' },
    { label: 'mcp', description: 'Model Context Protocol server' },
    { label: 'db', description: 'kick/db core — schema DSL, migrations' },
    { label: 'db-pg', description: 'kick/db PostgreSQL dialect + adapter' },
    { label: 'drizzle', description: 'Drizzle ORM adapter + query builder' },
    { label: 'prisma', description: 'Prisma adapter + query builder' },
    { label: 'testing', description: 'TestModule builder + helpers' },
  ]
}

async function pickAddPackage(): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(addPackageOptions(), {
    title: 'KickJS: add package',
    placeHolder: 'Pick the @forinda/kickjs-* package to install + register',
  })
  return choice?.label
}

function validateName(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return 'Name is required'
  if (!/^[a-z][a-z0-9-]*$/.test(trimmed)) {
    return 'Use kebab-case: lowercase letters, digits, hyphens (must start with a letter)'
  }
  return null
}

/**
 * Send a `kick <argv>` command to the shared KickJS terminal.
 * Reuses the terminal across invocations so a `dev` server stays
 * running on top while the user fires generators in the same panel.
 */
function runKick(argv: string): void {
  const terminal = getOrCreateTerminal()
  terminal.show(true)
  terminal.sendText(`${kickInvocation()} ${argv}`)
}

function getOrCreateTerminal(): vscode.Terminal {
  const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
  if (existing) return existing
  return vscode.window.createTerminal({
    name: TERMINAL_NAME,
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  })
}

/**
 * Resolve the package manager prefix for a `kick` invocation. The
 * lookup walks the first workspace folder for a lockfile; missing
 * lockfile falls through to `npx kick` so the command still runs on
 * a freshly-cloned repo with no node_modules yet.
 */
function kickInvocation(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root) return 'npx kick'
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm kick'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn kick'
  if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) {
    return 'bunx kick'
  }
  if (existsSync(join(root, 'package-lock.json'))) return 'npx kick'
  return 'npx kick'
}
