import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { Command } from 'commander'

/**
 * `kick mcp` — Model Context Protocol commands.
 *
 * Two subcommands:
 * - `kick mcp` (default → `start`): runs the built application as an
 *   MCP server over stdio. The user's app must already wire `McpAdapter`
 *   from `@forinda/kickjs-mcp` into its bootstrap. The CLI just spawns
 *   the built entry as a subprocess with `KICK_MCP_STDIO=1`, which the
 *   adapter detects and uses to switch its transport from
 *   StreamableHTTP to stdio. The subprocess inherits stdin/stdout/stderr
 *   so the MCP wire protocol flows directly between the parent process
 *   (the MCP client — Claude Code, Cursor, etc.) and the child app.
 * - `kick mcp init`: generates a `.mcp.json` config file pointing at
 *   this project, ready to drop into a Claude Code / Cursor workspace.
 *
 * Logs MUST go to stderr in stdio mode — anything written to stdout
 * corrupts the JSON-RPC protocol stream. Pino's default stream is
 * stderr already, so this works out of the box for KickJS apps using
 * the framework's bundled logger.
 */
export function registerMcpCommand(program: Command): void {
  const mcp = program.command('mcp').description('Model Context Protocol commands (start | init)')

  // ── kick mcp [start] — run as MCP server over stdio ────────────────
  mcp
    .command('start', { isDefault: true })
    .description('Run the built application as an MCP server over stdio')
    .option('-e, --entry <file>', 'Entry file', 'dist/index.js')
    .option('--node-arg <arg...>', 'Extra arguments to pass to node')
    .action(runMcpServer)

  // ── kick mcp init — generate .mcp.json for client tools ────────────
  mcp
    .command('init')
    .description('Generate .mcp.json for Claude Code / Cursor / Zed')
    .option('-n, --name <name>', 'Server name (defaults to package.json name)')
    .option('-o, --out <file>', 'Output file', '.mcp.json')
    .option('-f, --force', 'Overwrite an existing entry without prompting')
    .option('--global', 'Write to ~/.mcp.json instead of the project root')
    .action(initMcpConfig)
}

// ── Subcommand: start ─────────────────────────────────────────────────────

interface StartOptions {
  entry: string
  nodeArg?: string[]
}

function runMcpServer(opts: StartOptions): void {
  const entry = resolve(opts.entry)

  if (!existsSync(entry)) {
    process.stderr.write(
      `Error: entry file not found: ${entry}\n` +
        `\n` +
        `Build the app first with \`kick build\`, or pass a custom entry:\n` +
        `  kick mcp -e dist/server.js\n`,
    )
    process.exit(1)
  }

  // Spawn node with the user's entry. The KICK_MCP_STDIO env var tells
  // McpAdapter to switch its transport to stdio. We inherit all three
  // stdio streams so the MCP wire protocol flows directly between the
  // MCP client (parent process) and the user's app.
  const nodeArgs = [...(opts.nodeArg ?? []), entry]
  const child = spawn(process.execPath, nodeArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      KICK_MCP_STDIO: '1',
      NODE_ENV: process.env.NODE_ENV ?? 'production',
    },
  })

  child.on('error', (err) => {
    process.stderr.write(`Failed to start MCP server: ${err.message}\n`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })

  // Forward shutdown signals so the child can clean up gracefully
  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal)
  }
  process.on('SIGINT', () => forward('SIGINT'))
  process.on('SIGTERM', () => forward('SIGTERM'))
}

// ── Subcommand: init ──────────────────────────────────────────────────────

interface InitOptions {
  name?: string
  out: string
  force?: boolean
  global?: boolean
}

interface McpServerEntry {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

interface McpConfigFile {
  mcpServers: Record<string, McpServerEntry>
}

function initMcpConfig(opts: InitOptions): void {
  const cwd = process.cwd()
  const projectName = readPackageName(cwd) ?? basename(cwd)
  const serverName = opts.name ?? projectName

  const outPath = opts.global
    ? resolve(process.env.HOME ?? '.', '.mcp.json')
    : resolve(cwd, opts.out)

  // Build the server entry. The cwd field is set so the MCP client can
  // launch the command from anywhere — Claude Code / Cursor pass through
  // to spawn() and the built path is resolved relative to cwd.
  const entry: McpServerEntry = {
    command: 'kick',
    args: ['mcp'],
    cwd,
  }

  // Merge with an existing file rather than clobbering it. Multiple
  // projects often share a single .mcp.json — we want to add a new
  // server entry alongside whatever is already there.
  let config: McpConfigFile = { mcpServers: {} }
  if (existsSync(outPath)) {
    try {
      const raw = readFileSync(outPath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<McpConfigFile>
      if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
        config = { mcpServers: { ...parsed.mcpServers } }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(
        `Error: existing ${outPath} is not valid JSON (${message}).\n` +
          `Fix the file or pass --force to overwrite the entry.\n`,
      )
      process.exit(1)
    }
  }

  if (config.mcpServers[serverName] && !opts.force) {
    process.stderr.write(
      `Error: an entry for "${serverName}" already exists in ${outPath}.\n` +
        `Pass --force to overwrite it, or use --name to pick a different key.\n`,
    )
    process.exit(1)
  }

  config.mcpServers[serverName] = entry

  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf8')

  process.stdout.write(
    `\n  ✓ Wrote MCP server entry "${serverName}" to ${outPath}\n` +
      `\n` +
      `  To activate it:\n` +
      `    1. Build your app:    kick build\n` +
      `    2. Restart your MCP client (Claude Code, Cursor, Zed)\n` +
      `    3. The server should appear in the client's tool picker\n` +
      `\n`,
  )
}

/**
 * Read the `name` field from the project's `package.json`. Returns
 * null if the file is missing or unparseable — callers fall back to
 * the directory name in that case.
 */
function readPackageName(cwd: string): string | null {
  const pkgPath = resolve(cwd, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    const raw = readFileSync(pkgPath, 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown }
    if (typeof parsed.name === 'string') return parsed.name
    return null
  } catch {
    return null
  }
}
