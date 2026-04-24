/**
 * writeFileSafe format-on-write — verifies generated TS files come out
 * prettier-formatted by default, and that the format step is a polite
 * polish (no failure when prettier is missing or source is unparseable).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearFormatCache,
  setDryRun,
  setFormatOnWrite,
  writeFileSafe,
} from '../src/utils/fs'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'kick-cli-fs-format-'))
  clearFormatCache()
  setFormatOnWrite(true)
  setDryRun(false)
})

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

describe('writeFileSafe + format-on-write', () => {
  it('writes the file unconditionally', async () => {
    const file = join(cwd, 'sample.ts')
    await writeFileSafe(file, "export const x=1\n")
    expect(readFileSync(file, 'utf-8')).toContain('export const x')
  })

  it('formats .ts output via prettier (resolved from cwd)', async () => {
    const file = join(cwd, 'unformatted.ts')
    // Prettier defaults: no semicolons in this monorepo's .prettierrc; we
    // assert against a single-quote rewrite (default prettier config gives
    // double quotes, so we check the structural change instead).
    await writeFileSafe(file, "export const x   =1\n")
    const out = readFileSync(file, 'utf-8')
    // Triple-spaced assignment must collapse — that's prettier's job.
    expect(out).not.toContain('   =')
  })

  it('skips formatting for non-formattable extensions', async () => {
    const file = join(cwd, 'binary.bin')
    const raw = 'do  not  touch\n'
    await writeFileSafe(file, raw)
    expect(readFileSync(file, 'utf-8')).toBe(raw)
  })

  it('does not throw on unparseable source — leaves it raw', async () => {
    const file = join(cwd, 'broken.ts')
    const raw = 'this is // not (valid) TypeScript {{{ ====\n'
    await expect(writeFileSafe(file, raw)).resolves.not.toThrow()
    // Either prettier left it alone, or our catch silently swallowed —
    // either way, the file exists with the input content.
    expect(readFileSync(file, 'utf-8')).toContain('not (valid)')
  })

  it('honours setFormatOnWrite(false) for byte-stable test fixtures', async () => {
    setFormatOnWrite(false)
    const file = join(cwd, 'stable.ts')
    const raw = 'export const x   =1\n'
    await writeFileSafe(file, raw)
    expect(readFileSync(file, 'utf-8')).toBe(raw)
  })

  it('honours dry-run — writes nothing, no format', async () => {
    setDryRun(true)
    const file = join(cwd, 'dry.ts')
    await writeFileSafe(file, 'export const y = 2\n')
    setDryRun(false)
    expect(() => readFileSync(file, 'utf-8')).toThrow()
  })
})
