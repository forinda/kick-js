import * as vscode from 'vscode'
import { HealthTreeProvider } from './providers/health'
import { RoutesTreeProvider } from './providers/routes'
import { ContainerTreeProvider } from './providers/container'
import { DashboardPanel } from './panels/dashboard'
import { registerConnectCommand } from './commands/connect'
import { registerKickCommands } from './commands/kick'
import {
  DEFAULT_DEBUG_PATH,
  autoDetect,
  buildCandidates,
  isKickJsWorkspace,
  probeConnection,
} from './connection'

interface ProviderTrio {
  health: HealthTreeProvider
  routes: RoutesTreeProvider
  container: ContainerTreeProvider
  baseUrl: string
}

let current: ProviderTrio | null = null
let providerDisposables: vscode.Disposable[] = []

export async function activate(context: vscode.ExtensionContext) {
  // Gate every contribution on `kickjs.isKickProject` — the views +
  // command-palette entries in package.json declare
  // `when: kickjs.isKickProject`, so when this context is false the
  // activity-bar icon and palette commands disappear from non-kickjs
  // workspaces. Keeps the extension out of unrelated repos without
  // forcing the user to disable it.
  await refreshKickProjectContext()

  // Commands + config listener register unconditionally. The palette
  // hides them via `when` clauses on non-kickjs workspaces, but
  // keeping them registered means the workspace-folder change handler
  // below can flip the context key without forcing a window reload.
  // (Previously the early-return left these unregistered, so users
  // who opened a kickjs folder mid-session got the icon back but no
  // working palette commands.)
  registerCommands(context)

  let autoRefreshInterval: ReturnType<typeof setInterval> | null = null
  const startInterval = (): void => {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval)
    autoRefreshInterval = startAutoRefresh()
  }
  const stopInterval = (): void => {
    stopAutoRefresh(autoRefreshInterval)
    autoRefreshInterval = null
  }

  // React to URL / debugPath / autoRefresh changes without a window
  // reload. Settings.json edits + per-folder overrides + the Connect
  // command's update() all funnel through here.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('kickjs')) return
      if (!isKickProjectCached) return
      if (
        e.affectsConfiguration('kickjs.serverUrl') ||
        e.affectsConfiguration('kickjs.debugPath') ||
        e.affectsConfiguration('kickjs.token')
      ) {
        rebuildProviders(context)
      }
      if (e.affectsConfiguration('kickjs.autoRefresh')) {
        startInterval()
      }
    }),
    { dispose: () => stopInterval() },
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshKickProjectContext().then(() => {
        if (isKickProjectCached && !current) {
          rebuildProviders(context)
          startInterval()
          void maybeAutoConnect(context)
        } else if (!isKickProjectCached && current) {
          // Workspace flipped out of kickjs territory — tear down the
          // providers + interval so we stop polling localhost.
          disposeProviders()
          stopInterval()
        }
      })
    }),
  )

  if (isKickProjectCached) {
    rebuildProviders(context)
    startInterval()
    // First-run auto-detect: if the user hasn't yet picked a URL AND
    // the workspace looks like a KickJS project, race the standard
    // candidate list silently. A successful probe writes the URL to
    // workspace settings + pops a non-blocking 'connected' toast;
    // failures stay silent so the welcome view remains the primary
    // affordance.
    await maybeAutoConnect(context)
  }
}

/**
 * Register every palette command exactly once per activation. The
 * commands themselves are no-ops when no providers are wired (the
 * tree-view commands short-circuit on `current` being null), so it's
 * safe to register them on non-kickjs workspaces — they're hidden
 * from the palette by the `when: kickjs.isKickProject` clauses in
 * package.json regardless.
 */
function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerConnectCommand(context, {
      onConnected: () => rebuildProviders(context),
    }),
    vscode.commands.registerCommand('kickjs.inspect', () => {
      if (!current) {
        return vscode.commands.executeCommand('kickjs.connect')
      }
      DashboardPanel.createOrShow(context.extensionUri, current.baseUrl)
    }),
    vscode.commands.registerCommand('kickjs.showRoutes', () => current?.routes.refresh()),
    vscode.commands.registerCommand('kickjs.showContainer', () => current?.container.refresh()),
    vscode.commands.registerCommand('kickjs.showMetrics', () => current?.health.refresh()),
    vscode.commands.registerCommand('kickjs.refreshAll', () => refreshAll()),
    vscode.commands.registerCommand('kickjs.setToken', () => promptForToken(context)),
    vscode.commands.registerCommand('kickjs.clearToken', () => clearToken()),
    ...registerKickCommands(context),
    { dispose: () => disposeProviders() },
  )
}

let isKickProjectCached = false

/**
 * Re-evaluate whether any open workspace folder looks like a KickJS
 * project and broadcast the result via the `kickjs.isKickProject`
 * context key. The key drives the `when` clauses on every view +
 * command palette entry so non-kickjs workspaces never see the icon.
 */
async function refreshKickProjectContext(): Promise<void> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
  isKickProjectCached = isKickJsWorkspace(roots)
  await vscode.commands.executeCommand('setContext', 'kickjs.isKickProject', isKickProjectCached)
}

async function maybeAutoConnect(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('kickjs')
  const inspectedUrl = config.inspect<string>('serverUrl')
  const userPicked =
    inspectedUrl?.workspaceValue !== undefined ||
    inspectedUrl?.workspaceFolderValue !== undefined ||
    inspectedUrl?.globalValue !== undefined
  if (userPicked) {
    // Honour the explicit choice — verify it but don't probe alternatives.
    const result = await probeConnection(
      config.get<string>('serverUrl', 'http://localhost:3000'),
      config.get<string>('debugPath', DEFAULT_DEBUG_PATH),
      { token: config.get<string>('token') || undefined },
    )
    setConnected(result.ok)
    if (!result.ok && result.error.kind === 'unauthorized') {
      void offerSetToken(result.error.message)
    }
    return
  }

  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
  if (!isKickJsWorkspace(roots)) {
    setConnected(false)
    return
  }

  const candidates = buildCandidates(roots, config.get<string>('debugPath', DEFAULT_DEBUG_PATH))
  const result = await autoDetect(candidates)
  if (!result?.ok) {
    setConnected(false)
    return
  }

  // Auto-detected — record the choice + tell the user without a modal.
  const debugPath = config.get<string>('debugPath', DEFAULT_DEBUG_PATH)
  const serverUrl = result.baseUrl.replace(new RegExp(escapeRegex(debugPath) + '$'), '')
  await config.update('serverUrl', serverUrl, vscode.ConfigurationTarget.Workspace)
  rebuildProviders(context)
  vscode.window.showInformationMessage(`KickJS: auto-detected app at ${result.baseUrl}`)
}

function rebuildProviders(context: vscode.ExtensionContext): void {
  disposeProviders()
  const config = vscode.workspace.getConfiguration('kickjs')
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:3000')
  const debugPath = config.get<string>('debugPath', DEFAULT_DEBUG_PATH)
  const token = config.get<string>('token') || undefined
  const baseUrl = `${trimRightSlash(serverUrl)}${debugPath}`

  const health = new HealthTreeProvider(baseUrl, token)
  const routes = new RoutesTreeProvider(baseUrl, token)
  const container = new ContainerTreeProvider(baseUrl, token)

  providerDisposables.push(
    vscode.window.registerTreeDataProvider('kickjs.health', health),
    vscode.window.registerTreeDataProvider('kickjs.routes', routes),
    vscode.window.registerTreeDataProvider('kickjs.container', container),
    health.statusBarItem,
  )
  current = { health, routes, container, baseUrl }
  context.subscriptions.push(...providerDisposables)
  refreshAll()

  // The first refresh resolves async; mark connected eagerly so the
  // welcome view dismisses without a flash. The provider's own
  // disconnected handling will surface real failures via the status bar.
  setConnected(true)
}

function refreshAll(): void {
  if (!current) return
  current.health.refresh()
  current.routes.refresh()
  current.container.refresh()
}

function disposeProviders(): void {
  for (const d of providerDisposables) d.dispose()
  providerDisposables = []
  current = null
  setConnected(false)
}

function setConnected(connected: boolean): void {
  // Drives the `when: '!kickjs.connected'` clause on the welcome views
  // declared in package.json — flips them off the moment a probe lands.
  vscode.commands.executeCommand('setContext', 'kickjs.connected', connected)
}

function startAutoRefresh(): ReturnType<typeof setInterval> | null {
  if (!vscode.workspace.getConfiguration('kickjs').get<boolean>('autoRefresh', true)) return null
  return setInterval(refreshAll, 30000)
}

function stopAutoRefresh(handle: ReturnType<typeof setInterval> | null): void {
  if (handle) clearInterval(handle)
}

function trimRightSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Show an input box for the devtools auth token, then write it to
 * workspace `kickjs.token`. Triggered explicitly by the palette
 * command + automatically when a 401/403 surfaces in autoConnect.
 */
async function promptForToken(_context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('kickjs')
  const current = config.get<string>('token', '')
  const input = await vscode.window.showInputBox({
    title: 'KickJS: DevTools auth token',
    prompt:
      'Paste the token printed in your server console on startup ' +
      '(e.g. "[token: abc123…]"). Leave blank to clear.',
    value: current,
    password: true,
    placeHolder: 'abc123…',
  })
  if (input === undefined) return
  const trimmed = input.trim()
  const target =
    (vscode.workspace.workspaceFolders?.length ?? 0) > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global
  await config.update('token', trimmed || undefined, target)
  if (trimmed) {
    vscode.window.showInformationMessage('KickJS: token saved. Reconnecting…')
  } else {
    vscode.window.showInformationMessage('KickJS: token cleared.')
  }
  // Config-change listener triggers rebuildProviders → next refresh
  // uses the new token.
}

/** Wipe the workspace `kickjs.token` setting. */
async function clearToken(): Promise<void> {
  const config = vscode.workspace.getConfiguration('kickjs')
  const target =
    (vscode.workspace.workspaceFolders?.length ?? 0) > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global
  await config.update('token', undefined, target)
  vscode.window.showInformationMessage('KickJS: token cleared.')
}

/**
 * On 401/403 from a configured endpoint, surface a non-blocking
 * notification with a "Set token" CTA that opens the token prompt.
 * Distinguishes the wrong-token case from the missing-token case
 * via the {@link probeConnection} error message.
 */
async function offerSetToken(message: string): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    `KickJS: ${message}`,
    'Set token…',
    'Open settings',
  )
  if (action === 'Set token…') {
    await vscode.commands.executeCommand('kickjs.setToken')
  } else if (action === 'Open settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'kickjs.token')
  }
}

export function deactivate() {
  disposeProviders()
}
