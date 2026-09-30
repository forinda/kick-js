import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
    const flags = formatFlags(route.flags)
    this.description = flags ? `${route.handler} · ${flags}` : route.handler
    this.tooltip = [
      `${route.method} ${route.path}`,
      `Controller: ${route.controller}`,
      `Handler: ${route.handler}`,
      `Middleware: ${route.middleware?.join(', ') || 'none'}`,
      `Flags: ${flags || 'none'}`,
    ].join('\n')
    this.iconPath = new vscode.ThemeIcon(methodIcon(route.method))
    this.contextValue = 'kickjs.route'
    this.command = { command: 'kickjs.openHandler', title: 'Open Handler', arguments: [route] }
  }
}

/** Where the devtools `/source` endpoint found a handler. */
export interface HandlerSource {
  file: string
  relative: string
  line: number
}

/**
 * The file to open: the app's absolute path when it exists here, otherwise
 * its project-relative path under a workspace folder — the app may run in a
 * container or on another machine with a different checkout path.
 */
export function resolveSourcePath(
  found: HandlerSource,
  workspaceRoots: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (exists(found.file)) return found.file
  return workspaceRoots.map((root) => join(root, found.relative)).find(exists)
}

/** `kickjs.openHandler` — open a route's handler at its line. */
export async function openHandler(
  baseUrl: string,
  token: string | undefined,
  route: { controller: string; handler: string },
): Promise<void> {
  const query = new URLSearchParams({ controller: route.controller, handler: route.handler })
  const found = (await fetchDebugData(baseUrl, `/source?${query}`, token)) as HandlerSource | null
  const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
  const path = found ? resolveSourcePath(found, roots) : undefined
  if (!found || !path) {
    void vscode.window.showWarningMessage(
      `KickJS: couldn't find ${route.controller}.${route.handler} in the project source.`,
    )
    return
  }
  const at = new vscode.Position(found.line - 1, 0)
  await vscode.window.showTextDocument(vscode.Uri.file(path), {
    selection: new vscode.Range(at, at),
  })
}

/**
 * Route flags as sent by the devtools `/routes` endpoint (resolved
 * method-over-class). Bare flags carry `true` and print as their name;
 * valued flags print as `name=<json>`. Older devtools omit the field.
 */
export function formatFlags(flags: Record<string, unknown> | undefined): string {
  if (!flags) return ''
  return Object.entries(flags)
    .map(([name, value]) => (value === true ? name : `${name}=${JSON.stringify(value)}`))
    .join(', ')
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
