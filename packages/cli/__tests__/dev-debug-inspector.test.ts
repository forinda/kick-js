/**
 * `kick dev:debug` advertised a debugger that was never attached.
 *
 * It set `process.env.NODE_OPTIONS = '--inspect=…'` and then started the dev
 * server in-process. Node reads NODE_OPTIONS once, at startup, so the flag did
 * nothing — the server booted normally, printed `Debugger: ws://0.0.0.0:9229`,
 * and port 9229 was closed. Nothing failed, which is why it survived.
 *
 * @module @forinda/kickjs-cli/__tests__/dev-debug-inspector.test
 */

import { afterEach, describe, expect, it } from 'vitest'

import { openInspector } from '../src/commands/run'

afterEach(async () => {
  const inspector = await import('node:inspector')
  inspector.close()
})

describe('openInspector', () => {
  it('actually opens the port, and returns a connectable URL', async () => {
    // A high port, so a developer's own 9229 session cannot make this flaky.
    const url = await openInspector(39229, '127.0.0.1')

    // The session id is the part a hand-built ws://host:port URL lacks — and
    // without it a debugger client cannot attach even to an open port.
    expect(url).toMatch(/^ws:\/\/127\.0\.0\.1:39229\/[0-9a-f-]{36}$/)

    // The port is genuinely listening: the inspector's own HTTP endpoint answers.
    const res = await fetch('http://127.0.0.1:39229/json/version')
    expect(res.ok).toBe(true)
    expect(await res.json()).toHaveProperty('Protocol-Version')
  })

  it('binds to loopback by default', async () => {
    // An attached inspector evaluates arbitrary code in the process, so the
    // bind address is a security boundary, not a convenience. `node --inspect`
    // defaults to loopback for this reason; `dev:debug` used to hardcode
    // 0.0.0.0, which on a laptop means the café wifi.
    //
    // No host argument — the default is what this pins.
    const url = await openInspector(39232)

    expect(url).toContain('127.0.0.1')
    expect(url).not.toContain('0.0.0.0')
  })

  it('throws rather than reporting a URL it did not open', async () => {
    await openInspector(39230, '127.0.0.1')

    // Node refuses a second activation. Surfacing that beats returning the
    // still-valid URL of the FIRST port, which would tell the developer to
    // attach somewhere they did not ask for. `dev:debug` catches this and
    // suggests --inspect-port.
    await expect(openInspector(39231, '127.0.0.1')).rejects.toThrow(/already activated/i)
  })
})
