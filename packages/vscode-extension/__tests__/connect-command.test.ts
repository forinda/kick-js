/**
 * Tests for the Connect command — covers the three quick-pick paths
 * (auto, manual, settings), the typed failure messages, and the
 * post-success workspace-settings write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as vscode from 'vscode'
import { registerConnectCommand } from '../src/commands/connect'

// The vscode mock is a singleton — reach into it to reset spies between tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockVscode = vscode as unknown as Record<string, any>

function withFakeFetch(impl: typeof fetch): void {
  globalThis.fetch = impl
}

const fakeContext = {
  subscriptions: [],
  extensionUri: { fsPath: '/' },
} as unknown as vscode.ExtensionContext

describe('registerConnectCommand', () => {
  let onConnected: ReturnType<typeof vi.fn>
  let registeredHandler: () => Promise<void>

  beforeEach(() => {
    onConnected = vi.fn() as ReturnType<typeof vi.fn>
    mockVscode.window.showQuickPick.mockReset()
    mockVscode.window.showInputBox.mockReset()
    mockVscode.window.showInformationMessage.mockReset()
    mockVscode.window.showWarningMessage.mockReset()
    mockVscode.window.showErrorMessage.mockReset()
    mockVscode.commands.executeCommand.mockReset()
    mockVscode.workspace.workspaceFolders = undefined
    const updateSpy = vi.fn()
    mockVscode.workspace.getConfiguration.mockReturnValue({
      get: (_k: string, def: unknown) => def,
      update: updateSpy,
    })
    mockVscode.commands.registerCommand.mockImplementation(
      (_id: string, handler: () => Promise<void>) => {
        registeredHandler = handler
        return { dispose: vi.fn() }
      },
    )
    registerConnectCommand(fakeContext, { onConnected: onConnected as unknown as (s: string, d: string) => void })
  })

  it('opens settings when the user picks "Open settings"', async () => {
    mockVscode.window.showQuickPick.mockResolvedValue({ id: 'settings' })

    await registeredHandler()

    expect(mockVscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.openSettings',
      'kickjs.serverUrl',
    )
  })

  it('returns silently when the user cancels the quick-pick', async () => {
    mockVscode.window.showQuickPick.mockResolvedValue(undefined)

    await registeredHandler()

    expect(mockVscode.commands.executeCommand).not.toHaveBeenCalled()
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('manual: validates URL, probes, and writes settings on success', async () => {
    mockVscode.window.showQuickPick.mockResolvedValue({ id: 'manual' })
    mockVscode.window.showInputBox.mockResolvedValue('http://localhost:3000')
    withFakeFetch(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'healthy', uptime: 12 }),
      }) as unknown as typeof fetch,
    )

    await registeredHandler()

    const update = mockVscode.workspace.getConfiguration().update
    expect(update).toHaveBeenCalledWith('serverUrl', 'http://localhost:3000', expect.any(Number))
    expect(update).toHaveBeenCalledWith('debugPath', '/_debug', expect.any(Number))
    expect(onConnected).toHaveBeenCalledWith('http://localhost:3000', '/_debug')
    expect(mockVscode.window.showInformationMessage).toHaveBeenCalled()
  })

  it('manual: surfaces "not-found" with the kick-add-devtools hint', async () => {
    mockVscode.window.showQuickPick.mockResolvedValue({ id: 'manual' })
    mockVscode.window.showInputBox.mockResolvedValue('http://localhost:3000')
    mockVscode.window.showErrorMessage.mockResolvedValue(undefined)
    withFakeFetch(
      vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch,
    )

    await registeredHandler()

    expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('kick add devtools'),
      'Open Devtools docs',
      'Try another URL',
    )
    expect(onConnected).not.toHaveBeenCalled()
  })

  it('manual: surfaces "refused" and offers retry', async () => {
    mockVscode.window.showQuickPick.mockResolvedValue({ id: 'manual' })
    mockVscode.window.showInputBox.mockResolvedValue('http://localhost:3000')
    mockVscode.window.showErrorMessage.mockResolvedValue(undefined)
    withFakeFetch(
      vi.fn().mockRejectedValue(
        Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }),
      ) as unknown as typeof fetch,
    )

    await registeredHandler()

    expect(mockVscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('kick dev'),
      'Try another URL',
    )
  })

  it('auto: writes settings when a candidate responds', async () => {
    mockVscode.window.showQuickPick.mockResolvedValue({ id: 'auto' })
    let call = 0
    withFakeFetch(
      vi.fn().mockImplementation(async () => {
        call++
        if (call === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: 'healthy', uptime: 1 }),
          }
        }
        throw Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } })
      }) as unknown as typeof fetch,
    )

    await registeredHandler()

    expect(onConnected).toHaveBeenCalled()
  })

  it('auto: warns when nothing responds and offers Enter URL fallback', async () => {
    mockVscode.window.showQuickPick.mockResolvedValue({ id: 'auto' })
    mockVscode.window.showWarningMessage.mockResolvedValue(undefined)
    withFakeFetch(
      vi.fn().mockRejectedValue(
        Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } }),
      ) as unknown as typeof fetch,
    )

    await registeredHandler()

    expect(mockVscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('No KickJS app responded'),
      'Enter URL…',
      'Open settings',
    )
    expect(onConnected).not.toHaveBeenCalled()
  })
})
