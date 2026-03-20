import * as vscode from 'vscode'
import { fetchDebugData } from '../utils'

export class RoutesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private routes: any[] = []

  constructor(private baseUrl: string) {}

  refresh(): void {
    fetchDebugData(this.baseUrl, '/routes').then((d) => {
      this.routes = d?.routes ?? []
      this._onDidChangeTreeData.fire()
    })
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.TreeItem[] {
    if (this.routes.length === 0) return [new vscode.TreeItem('No routes')]

    return this.routes.map((r) => {
      const item = new vscode.TreeItem(
        `${r.method} ${r.path}`,
        vscode.TreeItemCollapsibleState.None,
      )
      item.description = `${r.controller}.${r.handler}`
      item.tooltip = `${r.method} ${r.path}\nController: ${r.controller}\nHandler: ${r.handler}\nMiddleware: ${r.middleware?.join(', ') || 'none'}`
      return item
    })
  }
}
