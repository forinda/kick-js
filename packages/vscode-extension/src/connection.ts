/**
 * Typed connection probe for the KickJS devtools endpoint.
 *
 * The pre-existing `fetchDebugData` collapses every failure mode into
 * `null`, so the UI can only show "Disconnected" — adopters can't
 * tell whether the server is down, the devtools adapter isn't
 * mounted, or auth blocked the request. This module surfaces each
 * case as its own discriminated variant so the connect UX can render
 * a specific remediation per failure.
 *
 * @module @forinda/kickjs-vscode/connection
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Default debug paths to try when none is set explicitly. */
export const DEFAULT_DEBUG_PATH = '/_debug'

/** Ports we probe in order during auto-detect. Common Node defaults. */
export const COMMON_DEV_PORTS = [3000, 3001, 4000, 5000, 8000, 8080] as const

/** Discriminated failure type — drives per-error remediation in the UI. */
export type ConnectionError =
  | { kind: 'refused'; url: string; message: string }
  | { kind: 'not-found'; url: string; status: 404; message: string }
  | { kind: 'unauthorized'; url: string; status: 401 | 403; message: string }
  | { kind: 'timeout'; url: string; message: string }
  | { kind: 'http'; url: string; status: number; message: string }
  | { kind: 'unknown'; url: string; message: string }

export interface ConnectionInfo {
  /** Server uptime in seconds, from `/health`. */
  uptime: number
  /** Health status string, e.g. `'healthy'`. */
  status: string
  /** Adapter-state map from `/health` (key -> 'running' | 'stopped'). */
  adapters?: Record<string, string>
}

export type ProbeResult =
  | { ok: true; info: ConnectionInfo; baseUrl: string }
  | { ok: false; error: ConnectionError; baseUrl: string }

export interface ProbeOptions {
  /** Override the default 2.5s probe timeout. Useful in tests. */
  timeoutMs?: number
  /** Injectable fetcher for tests; defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
  /**
   * Auth token to send as `x-devtools-token`. Optional — devtools
   * adapter defaults to no-token, so callers omit when the user
   * hasn't configured `kickjs.token` in workspace settings. When
   * the server requires a token and none is sent, the probe
   * surfaces an `unauthorized` error so the connect command can
   * prompt for one.
   */
  token?: string
}

/**
 * Single-shot probe of `<serverUrl><debugPath>/health`. Returns a
 * typed result rather than throwing - every UI surface gets the same
 * shape.
 */
export async function probeConnection(
  serverUrl: string,
  debugPath: string,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const baseUrl = `${trimRightSlash(serverUrl)}${debugPath}`
  const url = `${baseUrl}/health`
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const headers: Record<string, string> = {}
  if (opts.token) headers['x-devtools-token'] = opts.token
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 2500),
      headers,
    })
    if (res.status === 404) {
      return {
        ok: false,
        baseUrl,
        error: {
          kind: 'not-found',
          url,
          status: 404,
          message:
            'KickJS devtools endpoint not mounted. Run `kick add devtools` and ' +
            'register `DevToolsAdapter()` in your bootstrap.',
        },
      }
    }
    if (res.status === 401 || res.status === 403) {
      const hasToken = Boolean(opts.token)
      return {
        ok: false,
        baseUrl,
        error: {
          kind: 'unauthorized',
          url,
          status: res.status,
          message: hasToken
            ? `Devtools endpoint rejected the configured token (${res.status}). Update kickjs.token in settings or run "KickJS: Set Token" from the palette.`
            : `Devtools endpoint requires a token (${res.status}). Run "KickJS: Set Token" from the palette to paste the token printed in the server console (or set requireToken: false in your DevToolsAdapter config to disable auth).`,
        },
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        baseUrl,
        error: {
          kind: 'http',
          url,
          status: res.status,
          message: `Devtools endpoint returned HTTP ${res.status}.`,
        },
      }
    }
    const info = (await res.json()) as ConnectionInfo
    return { ok: true, baseUrl, info }
  } catch (err) {
    return classifyError(err, url, baseUrl)
  }
}

/**
 * Race a list of `(serverUrl, debugPath)` candidates and return the
 * first one that responds with a healthy probe. Used by the auto-
 * detect flow on first activation when no URL is configured yet.
 */
export async function autoDetect(
  candidates: Array<{ serverUrl: string; debugPath: string }>,
  opts: ProbeOptions = {},
): Promise<ProbeResult | null> {
  if (candidates.length === 0) return null
  const probes = candidates.map((c) => probeConnection(c.serverUrl, c.debugPath, opts))
  const results = await Promise.all(probes)
  return results.find((r) => r.ok) ?? null
}

/**
 * Build the candidate list from the workspace context - read `PORT`
 * from any `.env*` files, plus the standard dev-port fallbacks.
 * Returned in priority order (env-derived first).
 */
export function buildCandidates(
  workspaceRoots: readonly string[],
  debugPath: string = DEFAULT_DEBUG_PATH,
): Array<{ serverUrl: string; debugPath: string }> {
  const ports = new Set<number>()
  for (const root of workspaceRoots) {
    for (const port of readEnvPorts(root)) ports.add(port)
  }
  for (const port of COMMON_DEV_PORTS) ports.add(port)
  return [...ports].map((port) => ({ serverUrl: `http://localhost:${port}`, debugPath }))
}

/** Walk a workspace root for `.env*` files and extract `PORT=` values. */
export function readEnvPorts(root: string): number[] {
  const ports: number[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return []
  }
  for (const entry of entries) {
    if (!entry.startsWith('.env')) continue
    const full = join(root, entry)
    try {
      const text = readFileSync(full, 'utf-8')
      const match = /^\s*PORT\s*=\s*['"]?(\d+)['"]?/m.exec(text)
      if (match) ports.push(Number(match[1]))
    } catch {
      // Unreadable files are skipped - same posture as readdir failure.
    }
  }
  return ports
}

/** True if the workspace looks like a KickJS project — gates auto-detect prompts. */
export function isKickJsWorkspace(workspaceRoots: readonly string[]): boolean {
  for (const root of workspaceRoots) {
    if (existsSync(join(root, 'kick.config.ts'))) return true
    if (existsSync(join(root, 'kick.config.js'))) return true
    if (existsSync(join(root, 'kick.config.json'))) return true
    const pkgPath = join(root, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        if (Object.keys(deps).some((d) => d.startsWith('@forinda/kickjs'))) return true
      } catch {
        // Malformed package.json -> treat as not-a-kickjs workspace.
      }
    }
  }
  return false
}

function classifyError(err: unknown, url: string, baseUrl: string): ProbeResult {
  const name = (err as { name?: string }).name
  const code =
    (err as { code?: string; cause?: { code?: string } }).code ??
    (err as { cause?: { code?: string } }).cause?.code
  if (name === 'TimeoutError' || name === 'AbortError') {
    return {
      ok: false,
      baseUrl,
      error: {
        kind: 'timeout',
        url,
        message: 'Connection timed out. Is the dev server running but unresponsive?',
      },
    }
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return {
      ok: false,
      baseUrl,
      error: {
        kind: 'refused',
        url,
        message: `Cannot reach ${baseUrl}. Start the app with \`kick dev\` or update the server URL.`,
      },
    }
  }
  return {
    ok: false,
    baseUrl,
    error: {
      kind: 'unknown',
      url,
      message: (err as Error).message ?? 'Unknown connection error.',
    },
  }
}

function trimRightSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}
