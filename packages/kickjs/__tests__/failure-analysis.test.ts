import 'reflect-metadata'
import { createConnection, createServer } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Application, Container, type AppAdapter } from '../src/index'
import { builtInAdvice } from '../src/core/failure-analysis'

beforeEach(() => Container.reset())
afterEach(() => vi.restoreAllMocks())

/** A port nothing listens on: bind, read the port, close. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  await new Promise((r) => server.close(r))
  return port
}

const connect = (port: number) =>
  new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.end()
      resolve()
    })
    socket.on('error', reject)
  })

function captureErrors() {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((...args) => void lines.push(args.join(' ')))
  return lines
}

describe('startup failure advice', () => {
  it('explains a refused connection, naming the adapter hook, and rethrows the original error', async () => {
    const port = await closedPort()
    const db: AppAdapter = { name: 'Db', beforeStart: () => connect(port) }
    const lines = captureErrors()

    const failure = await new Application({ modules: [], adapters: [db] })
      .setup()
      .catch((err) => err)

    expect((failure as NodeJS.ErrnoException).code).toBe('ECONNREFUSED')
    const advice = lines.join('\n')
    expect(advice).toContain(`Db.beforeStart could not connect to 127.0.0.1:${port}`)
    expect(advice).toContain('Fix:')
  })

  it("prefers the adapter's own analysis, and survives one that throws", async () => {
    const own: AppAdapter = {
      name: 'Vector',
      beforeStart: () => {
        throw new Error('extension "vector" is not available')
      },
      analyzeFailure: (err) =>
        String(err).includes('vector')
          ? { summary: 'pgvector is not installed', fix: 'CREATE EXTENSION vector;' }
          : undefined,
    }
    let lines = captureErrors()
    await new Application({ modules: [], adapters: [own] }).setup().catch(() => {})
    expect(lines.join('\n')).toContain('pgvector is not installed')

    vi.restoreAllMocks()
    Container.reset()
    const port = await closedPort()
    const broken: AppAdapter = {
      name: 'Broken',
      beforeStart: () => connect(port),
      analyzeFailure: () => {
        throw new Error('analyzer bug')
      },
    }
    lines = captureErrors()
    await new Application({ modules: [], adapters: [broken] }).setup().catch(() => {})
    // Fell back to the built-in advice.
    expect(lines.join('\n')).toContain('connection refused')
  })
})

describe('builtInAdvice', () => {
  it('finds the code through cause chains and AggregateErrors', () => {
    const inner = Object.assign(new Error('x'), { code: 'ENOTFOUND', hostname: 'db.internal' })
    const wrapped = new Error('pool failed', { cause: new AggregateError([inner]) })
    expect(builtInAdvice(wrapped, 'Db.beforeStart')?.summary).toBe(
      'Db.beforeStart could not resolve the host db.internal',
    )
  })

  it('recognises rejected credentials and ignores everything else', () => {
    expect(
      builtInAdvice(new Error('password authentication failed for user "app"'), 'Db.beforeStart')
        ?.summary,
    ).toContain('credentials were not accepted')
    expect(builtInAdvice(new Error('something else'), 'Db.beforeStart')).toBeUndefined()
  })
})
