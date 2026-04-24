import * as vscode from 'vscode'
import { fetchDebugData } from '../utils'

export class ContainerTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private registrations: any[] = []

  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  refresh(): void {
    fetchDebugData(this.baseUrl, '/container', this.token).then((d) => {
      this.registrations = d?.registrations ?? []
      this._onDidChangeTreeData.fire()
    })
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element
  }

  getChildren(): vscode.TreeItem[] {
    if (this.registrations.length === 0) return [new vscode.TreeItem('No registrations')]

    return this.registrations.map((r) => {
      const item = new vscode.TreeItem(r.token, vscode.TreeItemCollapsibleState.None)
      item.description = `${r.scope} ${r.instantiated ? '(active)' : ''}`
      item.iconPath = new vscode.ThemeIcon(r.instantiated ? 'symbol-class' : 'symbol-interface')
      return item
    })
  }
}
