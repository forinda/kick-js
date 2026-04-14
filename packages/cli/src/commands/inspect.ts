import type { Command } from 'commander'
import { colors, httpMethodColor } from '../utils/colors'

const { bold, dim, green, red, yellow, cyan, blue } = colors

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function fetchEndpoint(base: string, path: string): Promise<any> {
  try {
    return await fetchJson(`${base}${path}`)
  } catch {
    return null
  }
}

interface InspectData {
  health: any
  metrics: any
  routes: any
  container: any
  ws: any
}

async function fetchAll(base: string): Promise<InspectData> {
  const [health, metrics, routes, container, ws] = await Promise.all([
    fetchEndpoint(base, '/health'),
    fetchEndpoint(base, '/metrics'),
    fetchEndpoint(base, '/routes'),
    fetchEndpoint(base, '/container'),
    fetchEndpoint(base, '/ws'),
  ])
  return { health, metrics, routes, container, ws }
}

// ── Display ─────────────────────────────────────────────────────────────────

function printSummary(base: string, data: InspectData): void {
  const { health, metrics, routes, container, ws } = data
  const line = dim('─'.repeat(60))

  console.log()
  console.log(bold(`  KickJS Inspector`) + dim(`  →  ${base}`))
  console.log(line)

  // Health
  if (health) {
    const statusText = health.status === 'healthy' ? green('● healthy') : red('● ' + health.status)
    console.log(`  ${bold('Health:')}    ${statusText}`)
  } else {
    console.log(`  ${bold('Health:')}    ${red('● unreachable')}`)
  }

  // Metrics
  if (metrics) {
    const rate = ((metrics.errorRate ?? 0) * 100).toFixed(1)
    const rateColor = metrics.errorRate > 0.1 ? red : metrics.errorRate > 0 ? yellow : green
    console.log(`  ${bold('Uptime:')}    ${formatUptime(metrics.uptimeSeconds)}`)
    console.log(`  ${bold('Requests:')}  ${metrics.requests}`)
    console.log(
      `  ${bold('Errors:')}    ${metrics.serverErrors} server, ${metrics.clientErrors ?? 0} client  ${dim('(')}${rateColor(rate + '%')}${dim(')')}`,
    )
  }

  // Container
  if (container) {
    console.log(`  ${bold('DI:')}        ${container.count} bindings`)
  }

  // WebSocket
  if (ws && ws.enabled) {
    console.log(
      `  ${bold('WS:')}        ${ws.connections ?? 0} connections, ${ws.namespaces ?? 0} namespaces`,
    )
  }

  // Routes table
  if (routes?.routes?.length) {
    console.log()
    console.log(bold('  Routes'))
    console.log(line)
    console.log(`  ${dim('METHOD')}  ${dim('PATH'.padEnd(36))} ${dim('CONTROLLER')}`)
    for (const r of routes.routes) {
      const path = r.path.length > 36 ? r.path.slice(0, 33) + '...' : r.path.padEnd(36)
      console.log(`  ${httpMethodColor(r.method)} ${path} ${blue(r.controller)}.${dim(r.handler)}`)
    }
  }

  console.log(line)
  console.log()
}

// ── Command Registration ────────────────────────────────────────────────────

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect [url]')
    .description('Connect to a running KickJS app and display debug info')
    .option('-p, --port <port>', 'Override port')
    .option('-w, --watch', 'Poll every 5 seconds')
    .option('-j, --json', 'Output raw JSON')
    .action(
      async (url: string | undefined, opts: { port?: string; watch?: boolean; json?: boolean }) => {
        let base = url ?? 'http://localhost:3000'

        // Override port if provided
        if (opts.port) {
          try {
            const parsed = new URL(base)
            parsed.port = opts.port
            base = parsed.origin
          } catch {
            base = `http://localhost:${opts.port}`
          }
        }

        const debugBase = `${base.replace(/\/$/, '')}/_debug`

        const run = async () => {
          try {
            const data = await fetchAll(debugBase)

            if (opts.json) {
              console.log(JSON.stringify(data, null, 2))
            } else {
              printSummary(base, data)
            }
          } catch (err) {
            if (opts.json) {
              console.log(JSON.stringify({ error: String(err) }))
            } else {
              console.error(red(`  ✖ Could not connect to ${base}`))
              console.error(dim(`    ${err instanceof Error ? err.message : String(err)}`))
            }
            if (!opts.watch) process.exitCode = 1
          }
        }

        if (opts.watch) {
          const poll = async () => {
            process.stdout.write('\x1b[2J\x1b[H') // clear screen
            await run()
          }
          await poll()
          setInterval(poll, 5000)
        } else {
          await run()
        }
      },
    )
}
