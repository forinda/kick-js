import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  resolveTypecheckBin,
  createDevTypechecker,
  formatTypecheckOutput,
} from '../src/commands/dev-typecheck'

// ── resolveTypecheckBin ─────────────────────────────────────────────────

describe('resolveTypecheckBin', () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'kick-tc-'))
  })

  afterEach(() => {
    rmSync(project, { recursive: true, force: true })
  })

  function writeBin(name: string): void {
    const bin = join(project, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, name), '')
  }

  it('prefers tsgo over tsc', () => {
    // Cover both platforms' shim names so the test passes everywhere.
    writeBin('tsgo')
    writeBin('tsgo.CMD')
    writeBin('tsc')
    writeBin('tsc.CMD')
    const bin = resolveTypecheckBin(project)
    expect(bin?.kind).toBe('tsgo')
    expect(bin?.args).toEqual(['--noEmit'])
  })

  it('falls back to tsc when tsgo is absent', () => {
    writeBin('tsc')
    writeBin('tsc.CMD')
    expect(resolveTypecheckBin(project)?.kind).toBe('tsc')
  })

  it('returns null when neither checker is installed', () => {
    expect(resolveTypecheckBin(project)).toBeNull()
  })
})

// ── createDevTypechecker ────────────────────────────────────────────────

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill(): boolean {
    this.killed = true
    return true
  }
}

function makeChecker(onResult: ReturnType<typeof vi.fn>) {
  const children: FakeChild[] = []
  const spawnFn = vi.fn(() => {
    const child = new FakeChild()
    children.push(child)
    return child as never
  })
  const checker = createDevTypechecker({
    cwd: '/proj',
    bin: { cmd: 'tsgo', args: ['--noEmit'], shell: false, kind: 'tsgo' },
    onResult,
    spawnFn: spawnFn as never,
  })
  return { checker, children, spawnFn }
}

describe('createDevTypechecker', () => {
  it('reports ok on exit code 0', () => {
    const onResult = vi.fn()
    const { checker, children } = makeChecker(onResult)
    checker.schedule()
    children[0].stdout.emit('data', Buffer.from('checked fine\n'))
    children[0].emit('close', 0)
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0].ok).toBe(true)
  })

  it('reports failure with captured output on non-zero exit', () => {
    const onResult = vi.fn()
    const { checker, children } = makeChecker(onResult)
    checker.schedule()
    children[0].stdout.emit('data', Buffer.from('src/a.ts(3,1): error TS2322: nope\n'))
    children[0].emit('close', 2)
    expect(onResult.mock.calls[0][0].ok).toBe(false)
    expect(onResult.mock.calls[0][0].output).toContain('TS2322')
  })

  it('kills the in-flight run when rescheduled and suppresses its result', () => {
    const onResult = vi.fn()
    const { checker, children } = makeChecker(onResult)
    checker.schedule()
    checker.schedule() // second save lands while first run is in flight
    expect(children[0].killed).toBe(true)
    // The superseded child's close must not produce a (stale) result.
    children[0].emit('close', 1)
    expect(onResult).not.toHaveBeenCalled()
    children[1].emit('close', 0)
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult.mock.calls[0][0].ok).toBe(true)
  })

  it('dispose() kills the in-flight run and stops reporting', () => {
    const onResult = vi.fn()
    const { checker, children } = makeChecker(onResult)
    checker.schedule()
    checker.dispose()
    expect(children[0].killed).toBe(true)
    children[0].emit('close', 0)
    expect(onResult).not.toHaveBeenCalled()
  })
})

// ── formatTypecheckOutput ───────────────────────────────────────────────

describe('formatTypecheckOutput', () => {
  it('passes short output through trimmed', () => {
    expect(formatTypecheckOutput('  a\nb  \n')).toBe('a\nb')
  })

  it('caps long output and reports the overflow', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `error line ${i}`).join('\n')
    const out = formatTypecheckOutput(lines, 10)
    expect(out.split('\n')).toHaveLength(11) // 10 lines + overflow notice
    expect(out).toContain('… 20 more line(s)')
  })
})
