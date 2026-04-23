/**
 * Interactive Connect command — palette entry that walks the user
 * through choosing or detecting a KickJS app to attach to.
 *
 * Three entry paths:
 * 1. Auto-detect — probe the workspace's `.env` PORTs + standard
 *    dev ports in parallel and offer the first hit.
 * 2. Manual URL — quickInput with live validation against the
 *    typed probe; surfaces refused / 404 / 401 / timeout
 *    differently so the user knows what to fix.
 * 3. Open settings — escape hatch when the URL needs to be set
 *    in workspace settings.json by hand.
 *
 * On success the chosen URL is written to workspace settings so
 * the choice survives reloads and per-folder configurations work
 * correctly in multi-root workspaces.
 *
 * @module @forinda/kickjs-vscode/commands/connect
 */

import * as vscode from 'vscode'
import {
  DEFAULT_DEBUG_PATH,
  autoDetect,
  buildCandidates,
  probeConnection,
  type ProbeResult,
} from '../connection'

export interface ConnectCommandDeps {
  /** Called after a successful probe so the activate-time refresh runs. */
  onConnected: (serverUrl: string, debugPath: string) => void
}

export function registerConnectCommand(
  context: vscode.ExtensionContext,
  deps: ConnectCommandDeps,
): vscode.Disposable {
  return vscode.commands.registerCommand('kickjs.connect', async () => {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '$(search) Auto-detect',
          description: 'Probe common dev ports + .env',
          id: 'auto' as const,
        },
        {
          label: '$(globe) Enter URL…',
          description: 'http://localhost:3000',
          id: 'manual' as const,
        },
        {
          label: '$(settings-gear) Open settings',
          description: 'Edit kickjs.serverUrl by hand',
          id: 'settings' as const,
        },
      ],
      {
        title: 'Connect to a KickJS app',
        placeHolder: 'How would you like to connect?',
      },
    )
    if (!choice) return

    if (choice.id === 'settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'kickjs.serverUrl')
      return
    }

    if (choice.id === 'auto') {
      await runAutoDetect(deps)
      return
    }

    await runManualConnect(deps)
  })
}

async function runAutoDetect(deps: ConnectCommandDeps): Promise<void> {
  const debugPath = readDebugPath()
  const roots = workspaceRoots()
  const candidates = buildCandidates(roots, debugPath)

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'KickJS: probing for a running app…',
      cancellable: false,
    },
    () => autoDetect(candidates),
  )

  if (!result || !result.ok) {
    const action = await vscode.window.showWarningMessage(
      `No KickJS app responded on any of: ${candidates.map((c) => c.serverUrl).join(', ')}`,
      'Enter URL…',
      'Open settings',
    )
    if (action === 'Enter URL…') return runManualConnect(deps)
    if (action === 'Open settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'kickjs.serverUrl')
    }
    return
  }

  await acceptResult(result, debugPath, deps)
}

async function runManualConnect(deps: ConnectCommandDeps): Promise<void> {
  const debugPath = readDebugPath()
  const currentUrl = readServerUrl()

  const url = await vscode.window.showInputBox({
    title: 'KickJS: server URL',
    prompt: `Probes ${'<URL>'}${debugPath}/health to verify`,
    value: currentUrl,
    placeHolder: 'http://localhost:3000',
    validateInput: (input) => validateUrl(input),
  })
  if (!url) return

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `KickJS: probing ${url}${debugPath}…`,
      cancellable: false,
    },
    () => probeConnection(url, debugPath),
  )

  if (!result.ok) {
    await reportFailure(result)
    return
  }

  await acceptResult(result, debugPath, deps)
}

async function acceptResult(
  result: ProbeResult & { ok: true },
  debugPath: string,
  deps: ConnectCommandDeps,
): Promise<void> {
  const serverUrl = result.baseUrl.replace(new RegExp(escapeRegex(debugPath) + '$'), '')
  const target =
    workspaceRoots().length > 0
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global
  const config = vscode.workspace.getConfiguration('kickjs')
  await config.update('serverUrl', serverUrl, target)
  await config.update('debugPath', debugPath, target)
  deps.onConnected(serverUrl, debugPath)
  vscode.window.showInformationMessage(
    `KickJS: connected to ${result.baseUrl} (uptime ${result.info.uptime}s, status ${result.info.status})`,
  )
}

async function reportFailure(result: ProbeResult & { ok: false }): Promise<void> {
  const error = result.error
  switch (error.kind) {
    case 'not-found': {
      const action = await vscode.window.showErrorMessage(
        error.message,
        'Open Devtools docs',
        'Try another URL',
      )
      if (action === 'Open Devtools docs') {
        vscode.env.openExternal(
          vscode.Uri.parse('https://forinda.github.io/kick-js/guide/devtools'),
        )
      } else if (action === 'Try another URL') {
        await vscode.commands.executeCommand('kickjs.connect')
      }
      return
    }
    case 'unauthorized': {
      vscode.window.showErrorMessage(error.message)
      return
    }
    case 'refused': {
      const action = await vscode.window.showErrorMessage(error.message, 'Try another URL')
      if (action === 'Try another URL') {
        await vscode.commands.executeCommand('kickjs.connect')
      }
      return
    }
    case 'timeout':
    case 'http':
    case 'unknown': {
      vscode.window.showErrorMessage(`KickJS: ${error.message}`)
      return
    }
  }
}

function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
}

function readServerUrl(): string {
  return vscode.workspace
    .getConfiguration('kickjs')
    .get<string>('serverUrl', 'http://localhost:3000')
}

function readDebugPath(): string {
  return vscode.workspace.getConfiguration('kickjs').get<string>('debugPath', DEFAULT_DEBUG_PATH)
}

function validateUrl(input: string): string | null {
  if (!input.trim()) return 'URL is required'
  try {
    const u = new URL(input)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'URL must use http or https'
    return null
  } catch {
    return 'Not a valid URL (e.g. http://localhost:3000)'
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
