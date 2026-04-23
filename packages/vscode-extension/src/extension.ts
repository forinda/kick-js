import * as vscode from 'vscode'
import { HealthTreeProvider } from './providers/health'
import { RoutesTreeProvider } from './providers/routes'
import { ContainerTreeProvider } from './providers/container'
import { DashboardPanel } from './panels/dashboard'
import { registerConnectCommand } from './commands/connect'
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
  rebuildProviders(context)

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
    { dispose: () => disposeProviders() },
  )

  let interval = startAutoRefresh()
  context.subscriptions.push({ dispose: () => stopAutoRefresh(interval) })

  // React to URL / debugPath / autoRefresh changes without a window
  // reload. Settings.json edits + per-folder overrides + the Connect
  // command's update() all funnel through here.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('kickjs')) return
      if (
        e.affectsConfiguration('kickjs.serverUrl') ||
        e.affectsConfiguration('kickjs.debugPath')
      ) {
        rebuildProviders(context)
      }
      if (e.affectsConfiguration('kickjs.autoRefresh')) {
        stopAutoRefresh(interval)
        interval = startAutoRefresh()
      }
    }),
  )

  // First-run auto-detect: if the user hasn't yet picked a URL AND the
  // workspace looks like a KickJS project, race the standard candidate
  // list silently. A successful probe writes the URL to workspace
  // settings and pops a non-blocking 'connected' notification; failures
  // stay silent so the welcome view remains the primary affordance.
  await maybeAutoConnect(context)
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
    )
    setConnected(result.ok)
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
  const baseUrl = `${trimRightSlash(serverUrl)}${debugPath}`

  const health = new HealthTreeProvider(baseUrl)
  const routes = new RoutesTreeProvider(baseUrl)
  const container = new ContainerTreeProvider(baseUrl)

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

export function deactivate() {
  disposeProviders()
}
