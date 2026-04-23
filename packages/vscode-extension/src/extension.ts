import * as vscode from 'vscode'
import { HealthTreeProvider } from './providers/health'
import { RoutesTreeProvider } from './providers/routes'
import { ContainerTreeProvider } from './providers/container'
import { DashboardPanel } from './panels/dashboard'
import { registerConnectCommand } from './commands/connect'
import { DEFAULT_DEBUG_PATH } from './connection'

interface ProviderTrio {
  health: HealthTreeProvider
  routes: RoutesTreeProvider
  container: ContainerTreeProvider
  baseUrl: string
}

let current: ProviderTrio | null = null
let providerDisposables: vscode.Disposable[] = []

export function activate(context: vscode.ExtensionContext) {
  // Provider trio is rebuilt every time the URL changes (commit 4 wires
  // a config-change listener) so we keep the wiring in a helper that
  // both initial activate + connect-command success can call.
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

  if (vscode.workspace.getConfiguration('kickjs').get<boolean>('autoRefresh', true)) {
    const interval = setInterval(refreshAll, 30000)
    context.subscriptions.push({ dispose: () => clearInterval(interval) })
  }
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
}

function trimRightSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

export function deactivate() {
  disposeProviders()
}
