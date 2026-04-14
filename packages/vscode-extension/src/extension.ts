import * as vscode from 'vscode'
import { HealthTreeProvider } from './providers/health'
import { RoutesTreeProvider } from './providers/routes'
import { ContainerTreeProvider } from './providers/container'
import { DashboardPanel } from './panels/dashboard'

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('kickjs')
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:3000')
  const debugPath = config.get<string>('debugPath', '/_debug')
  const baseUrl = `${serverUrl}${debugPath}`

  // Tree data providers
  const healthProvider = new HealthTreeProvider(baseUrl)
  const routesProvider = new RoutesTreeProvider(baseUrl)
  const containerProvider = new ContainerTreeProvider(baseUrl)

  vscode.window.registerTreeDataProvider('kickjs.health', healthProvider)
  vscode.window.registerTreeDataProvider('kickjs.routes', routesProvider)
  vscode.window.registerTreeDataProvider('kickjs.container', containerProvider)

  // Status bar item managed by health provider
  context.subscriptions.push(healthProvider.statusBarItem)

  const refreshAll = () => {
    healthProvider.refresh()
    routesProvider.refresh()
    containerProvider.refresh()
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('kickjs.inspect', () => {
      DashboardPanel.createOrShow(context.extensionUri, baseUrl)
    }),
    vscode.commands.registerCommand('kickjs.showRoutes', () => routesProvider.refresh()),
    vscode.commands.registerCommand('kickjs.showContainer', () => containerProvider.refresh()),
    vscode.commands.registerCommand('kickjs.showMetrics', () => healthProvider.refresh()),
    vscode.commands.registerCommand('kickjs.refreshAll', refreshAll),
  )

  // Auto-refresh
  if (config.get<boolean>('autoRefresh', true)) {
    const interval = setInterval(refreshAll, 30000)
    context.subscriptions.push({ dispose: () => clearInterval(interval) })
  }

  // Initial fetch
  refreshAll()
}

export function deactivate() {}
