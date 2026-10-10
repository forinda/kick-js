import { describe, it, expect, vi, afterEach } from 'vitest'
import { Logger, ConsoleLoggerProvider, type LoggerProvider } from '../src/index'
import { requestLogger } from '../src/http/middleware/request-logger'

/** ANSI colour codes, built from a string so the regex holds no control character. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

afterEach(() => {
  delete process.env.LOG_FORMAT
  vi.restoreAllMocks()
  Logger.resetProvider()
})

/** Every console.log line, parsed — JSON mode writes all levels there. */
function captureJson(): Array<Record<string, any>> {
  const lines: Array<Record<string, any>> = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)))
  })
  return lines
}

describe('default text output is unchanged', () => {
  it('writes the same console arguments as before, child fields included or not', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    Logger.setProvider(new ConsoleLoggerProvider())
    const extra = { id: 7 }
    Logger.for('Orders').info('saved %s', 'order', extra)
    Logger.for('Orders').child({ requestId: 'r1' }).info('saved')
    // Colour depends on the terminal running the tests: compare without ANSI codes.
    const plain = log.mock.calls.map((c) =>
      c.map((a) => (typeof a === 'string' ? a.replace(ANSI, '') : a)),
    )
    expect(plain).toEqual([['INFO [Orders] saved %s', 'order', extra], ['INFO [Orders] saved']])
  })
})

describe('LOG_FORMAT=json', () => {
  it('writes one pino-compatible object per line with fields, err and filled placeholders', () => {
    process.env.LOG_FORMAT = 'json'
    const lines = captureJson()
    const log = Logger.for('Orders')
    log.info('saved %s #%d', 'order', 42, { userId: 'u1' })
    const cause = new Error('connection refused')
    log.error(new Error('save failed', { cause }), 'could not save')

    expect(lines[0]).toMatchObject({
      level: 30,
      component: 'Orders',
      userId: 'u1',
      msg: 'saved order #42',
    })
    expect(typeof lines[0]!.time).toBe('number')
    expect(lines[1]).toMatchObject({
      level: 50,
      msg: 'could not save',
      err: { type: 'Error', message: 'save failed', cause: { message: 'connection refused' } },
    })
    expect(lines[1]!.err.stack).toContain('save failed')
  })

  it("carries child fields on every line, a call's own fields winning", () => {
    process.env.LOG_FORMAT = 'json'
    const lines = captureJson()
    const req = Logger.for('HTTP').child({ requestId: 'r1', tenant: 'a' })
    req.warn('slow', { tenant: 'b' })
    req.child({ step: 2 }).info('done')
    expect(lines[0]).toMatchObject({ level: 40, component: 'HTTP', requestId: 'r1', tenant: 'b' })
    expect(lines[1]).toMatchObject({ requestId: 'r1', tenant: 'a', step: 2, msg: 'done' })
  })

  it('never lets logged data rewrite level, time, component, msg or err', () => {
    process.env.LOG_FORMAT = 'json'
    const lines = captureJson()
    const body = JSON.parse(
      '{"level":10,"time":0,"component":"Auth","msg":"fine","err":"none","__proto__":{"x":1},"name":"a"}',
    )
    Logger.for('Signup').child({ level: 10 }).error('signup failed', body, new Error('boom'))
    expect(lines[0]).toMatchObject({
      level: 50,
      component: 'Signup',
      msg: 'signup failed',
      name: 'a',
      err: { message: 'boom' },
    })
    expect(lines[0]!.time).toBeGreaterThan(0)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('respects LOG_LEVEL and survives circular fields', () => {
    process.env.LOG_FORMAT = 'json'
    const lines = captureJson()
    const loop: Record<string, unknown> = {}
    loop.self = loop
    Logger.for('X').debug('hidden')
    const err = Object.assign(new Error('db down'), { request: loop })
    Logger.for('X').error('kept', { loop, id: 7, big: 10n }, err)
    expect(lines).toHaveLength(1)
    // Only what can't be written is dropped: other fields stay, err keeps its essentials.
    expect(lines[0]).toMatchObject({
      component: 'X',
      msg: 'kept',
      id: 7,
      big: '10',
      loop: '[unserializable]',
      err: { type: 'Error', message: 'db down' },
    })
    expect(lines[0]!.err.stack).toContain('db down')
  })

  it('gives the request logger queryable fields', () => {
    process.env.LOG_FORMAT = 'json'
    const lines = captureJson()
    let finish = () => {}
    requestLogger()(
      { method: 'GET', url: '/users?page=2', headers: { 'x-request-id': 'req-1' } },
      { statusCode: 200, on: (_e: 'finish', fn: () => void) => (finish = fn) },
      () => {},
    )
    finish()
    expect(lines[0]).toMatchObject({
      component: 'HTTP',
      method: 'GET',
      path: '/users?page=2',
      status: 200,
      requestId: 'req-1',
    })
    expect(lines[0]!.msg).toMatch(/^GET \/users\?page=2 200 \d+ms req-1$/)
  })
})

describe('custom providers', () => {
  it('receive child fields alongside the component they already read', () => {
    const children: unknown[] = []
    const custom: LoggerProvider = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: (bindings) => (children.push(bindings), custom),
    }
    Logger.setProvider(custom)
    Logger.for('Jobs').child({ job: 'sweep' }).info('ran')
    expect(children).toContainEqual({ component: 'Jobs' })
    expect(children).toContainEqual({ component: 'Jobs', job: 'sweep' })
  })
})
