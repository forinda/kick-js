import * as vscode from 'vscode'
import { fetchDebugData } from '../utils'

export class HealthTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private data: any = null

  constructor(private baseUrl: string) {}

  refresh(): void {
    fetchDebugData(this.baseUrl, '/health').then((d) => {
      this.data = d
      this._onDidChangeTreeData.fire()
    })
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.data) return [new vscode.TreeItem('Loading...')]

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
}
