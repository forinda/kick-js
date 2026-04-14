import * as vscode from 'vscode'
import { fetchDebugData } from '../utils'

export class HealthTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private data: any = null
  private connected = false

  /** Status bar item showing connection state */
  readonly statusBarItem: vscode.StatusBarItem

  constructor(private baseUrl: string) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.statusBarItem.command = 'kickjs.inspect'
    this.updateStatusBar()
    this.statusBarItem.show()
  }

  refresh(): void {
    fetchDebugData(this.baseUrl, '/health').then((d) => {
      this.data = d
      this.connected = d !== null
      this.updateStatusBar()
      this._onDidChangeTreeData.fire()
    })
  }

  isConnected(): boolean {
    return this.connected
  }

  private updateStatusBar(): void {
    if (!this.connected) {
      this.statusBarItem.text = '$(debug-disconnect) KickJS: Disconnected'
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
      this.statusBarItem.tooltip = `Cannot reach ${this.baseUrl}\nClick to open dashboard`
      return
    }

    const status = this.data?.status ?? 'unknown'
    if (status === 'healthy') {
      this.statusBarItem.text = '$(check) KickJS: Healthy'
      this.statusBarItem.backgroundColor = undefined
    } else {
      this.statusBarItem.text = `$(warning) KickJS: ${status}`
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
    }
    this.statusBarItem.tooltip = `Status: ${status}\nUptime: ${this.data?.uptime ?? 0}s\nClick to open dashboard`
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.data) {
      const item = new vscode.TreeItem('Disconnected — check server URL')
      item.iconPath = new vscode.ThemeIcon('debug-disconnect')
      return [item]
    }

    const items: vscode.TreeItem[] = []
    const status = new vscode.TreeItem(
      `Status: ${this.data.status}`,
      vscode.TreeItemCollapsibleState.None,
    )
    status.iconPath = new vscode.ThemeIcon(this.data.status === 'healthy' ? 'pass' : 'error')
    items.push(status)
    items.push(new vscode.TreeItem(`Uptime: ${this.data.uptime}s`))
    items.push(new vscode.TreeItem(`Error Rate: ${((this.data.errorRate ?? 0) * 100).toFixed(2)}%`))

    if (this.data.adapters) {
      for (const [name, state] of Object.entries(this.data.adapters)) {
        const item = new vscode.TreeItem(`${name}: ${state}`)
        item.iconPath = new vscode.ThemeIcon(state === 'running' ? 'check' : 'warning')
        items.push(item)
      }
    }

    return items
  }

  dispose(): void {
    this.statusBarItem.dispose()
  }
}
