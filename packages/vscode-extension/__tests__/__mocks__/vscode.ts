/**
 * Minimal vscode module mock for unit testing tree providers.
 * Only stubs the APIs actually used by the extension.
 */
import { vi } from 'vitest'

export class TreeItem {
  label: string
  collapsibleState: number
  description?: string
  tooltip?: string
  iconPath?: ThemeIcon
  command?: unknown

  constructor(label: string, collapsibleState = 0) {
    this.label = label
    this.collapsibleState = collapsibleState
  }
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
}

export class ThemeIcon {
  id: string
  constructor(id: string) {
    this.id = id
  }
}

export class ThemeColor {
  id: string
  constructor(id: string) {
    this.id = id
  }
}

export class EventEmitter {
  private listeners: Array<() => void> = []
  event = (listener: () => void) => {
    this.listeners.push(listener)
    return { dispose: () => {} }
  }
  fire() {
    for (const l of this.listeners) l()
  }
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const window: Record<string, any> = {
  createStatusBarItem: vi.fn(() => ({
    text: '',
    tooltip: '',
    command: '',
    backgroundColor: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  registerTreeDataProvider: vi.fn(),
  createWebviewPanel: vi.fn(),
  showInformationMessage: vi.fn(),
}

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn((key: string, defaultValue: unknown) => defaultValue),
  })),
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commands: Record<string, any> = {
  registerCommand: vi.fn(),
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file' }),
}

export enum ViewColumn {
  One = 1,
}
