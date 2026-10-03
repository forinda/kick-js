/**
 * Vitest wiring for a test app: one call per file instead of the
 * `let app` / `beforeAll` / `afterAll` boilerplate.
 *
 *   const t = useTestApp(() => ({ ...appOptions, overrides: [[MAILER, fakeMailer]] }))
 *
 *   it('lists invoices', async () => {
 *     await t.client().as(token).get('/api/v1/invoices').expect(200)
 *   })
 */
import { afterAll, beforeAll, beforeEach } from 'vitest'
import type { Application, Container } from '@forinda/kickjs'
import { createTestApp, type CreateTestAppOptions } from './index'
import type { TestClient, TestClientOptions } from './client'
import { resetTestState } from './reset'

export interface UseTestAppOptions {
  /**
   * Keep one app for every file this worker runs (with `isolate: false`)
   * instead of one per file — far faster for a large suite. It is shut down
   * when the worker exits. Default `false`.
   */
  shared?: boolean
  /**
   * When `onTestReset` resets run: before each test file (`'file'`, the
   * default), before each test (`'test'`), or never (`false`).
   */
  reset?: 'file' | 'test' | false
  /** Client options for `t.client()` with no arguments — the usual host or base path. */
  client?: TestClientOptions
}

export interface TestAppHandle {
  readonly app: Application
  readonly container: Container
  /** A request client; with no options, the defaults from `useTestApp`. */
  client(options?: TestClientOptions): TestClient
}

type Created = Awaited<ReturnType<typeof createTestApp>>

let shared: Promise<Created> | undefined

export function useTestApp(
  options: () => CreateTestAppOptions | Promise<CreateTestAppOptions>,
  settings: UseTestAppOptions = {},
): TestAppHandle {
  let created: Created | undefined
  const build = async () => createTestApp(await options())

  beforeAll(async () => {
    if (settings.reset !== false) await resetTestState()
    if (settings.shared) {
      if (!shared) {
        shared = build()
        // One app for the worker: closed when the worker goes.
        process.once('beforeExit', () => {
          void shared?.then(({ app }) => app.shutdown())
        })
      }
      created = await shared
    } else {
      created = await build()
    }
  })

  afterAll(async () => {
    if (!settings.shared) await created?.app.shutdown()
    created = undefined
  })

  if (settings.reset === 'test') beforeEach(() => resetTestState())

  const ready = (): Created => {
    if (!created) throw new Error('useTestApp: the app is only available inside tests and hooks')
    return created
  }
  return {
    get app() {
      return ready().app
    },
    get container() {
      return ready().container
    },
    client(clientOptions) {
      return ready().client(clientOptions ?? settings.client)
    },
  }
}
