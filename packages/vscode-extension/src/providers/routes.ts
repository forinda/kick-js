import * as vscode from 'vscode'
import { fetchDebugData } from '../utils'

/** Tree item representing a controller group */
class ControllerItem extends vscode.TreeItem {
  routes: any[]
  constructor(
    public readonly controllerName: string,
    routes: any[],
  ) {
    super(controllerName, vscode.TreeItemCollapsibleState.Expanded)
    this.routes = routes
    this.iconPath = new vscode.ThemeIcon('symbol-class')
    this.description = `${routes.length} route${routes.length === 1 ? '' : 's'}`
  }
}

/** Tree item representing a single route */
class RouteItem extends vscode.TreeItem {
  constructor(route: any) {
    super(`${route.method} ${route.path}`, vscode.TreeItemCollapsibleState.None)
    this.description = route.handler
    this.tooltip = [
      `${route.method} ${route.path}`,
      `Controller: ${route.controller}`,
      `Handler: ${route.handler}`,
      `Middleware: ${route.middleware?.join(', ') || 'none'}`,
    ].join('\n')
    this.iconPath = new vscode.ThemeIcon(methodIcon(route.method))
  }
}

function methodIcon(method: string): string {
  switch (method) {
    case 'GET':
      return 'arrow-down'
    case 'POST':
      return 'add'
    case 'PUT':
    case 'PATCH':
      return 'edit'
    case 'DELETE':
      return 'trash'
    default:
      return 'circle-outline'
  }
}

export class RoutesTreeProvider implements vscode.TreeDataProvider<ControllerItem | RouteItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event
  private routes: any[] = []

  constructor(
    private baseUrl: string,
    private token?: string,
  ) {}

  refresh(): void {
    fetchDebugData(this.baseUrl, '/routes', this.token).then((d) => {
      this.routes = d?.routes ?? []
      this._onDidChangeTreeData.fire()
    })
  }

  getTreeItem(element: ControllerItem | RouteItem): vscode.TreeItem {
    return element
  }

  getChildren(element?: ControllerItem | RouteItem): (ControllerItem | RouteItem)[] {
    // Route items have no children
    if (element instanceof RouteItem) return []

    // Controller item — return its routes
    if (element instanceof ControllerItem) {
      return element.routes.map((r: any) => new RouteItem(r))
    }

    // Root — group routes by controller
    if (this.routes.length === 0) return [new vscode.TreeItem('No routes') as any]

    const groups = new Map<string, any[]>()
    for (const route of this.routes) {
      const name = route.controller ?? 'Unknown'
      if (!groups.has(name)) groups.set(name, [])
      groups.get(name)!.push(route)
    }

    return Array.from(groups.entries()).map(([name, routes]) => new ControllerItem(name, routes))
  }
}
