/**
 * `kickTestServices`: one container per service for the whole test run, for
 * a Vitest `globalSetup`. Kept apart from `./vitest` on purpose: a global
 * setup runs outside Vitest's workers, where importing `vitest` itself can
 * fail, so nothing here imports it.
 */
import {
  SERVICE_PRESETS,
  startContainer,
  startService,
  type ContainerSpec,
  type ServiceKind,
  type ServiceOptions,
} from './services'

/** One service for {@link kickTestServices}: a preset (by its key), or any container. */
export type TestServiceSetup = ServiceOptions | { container: ContainerSpec }

/**
 * The URLs {@link kickTestServices} hands to test files, by key. Add your own
 * keys by augmenting it:
 *
 * ```ts
 * declare module '@forinda/kickjs-testing' {
 *   interface KickTestServices { search: string }
 * }
 * ```
 */
export interface KickTestServices {
  postgres: string
  mysql: string
  redis: string
  minio: string
}

/** `search-engine` → `KICK_TEST_SEARCH_ENGINE_URL`. */
const envName = (key: string) => `KICK_TEST_${key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_URL`

/**
 * A Vitest `globalSetup`: starts each service once for the whole run (a named
 * one is reused across runs), then hands its URL to every test file — as
 * `inject('<key>')`, and as `KICK_TEST_<KEY>_URL` for config read at import.
 *
 * ```ts
 * // tests/global-setup.ts
 * export default kickTestServices({ postgres: { name: 'myapp-test-pg' } })
 * ```
 *
 * @see https://kickjs.app/guide/testing/large-suites
 */
export function kickTestServices(
  services: Record<string, TestServiceSetup>,
): (project: { provide(key: string, value: unknown): void }) => Promise<() => Promise<void>> {
  return async (project) => {
    const entries = Object.entries(services)
    // Every key first: nothing starts when one of them is wrong.
    for (const [key, setup] of entries) {
      if (!('container' in setup) && !(key in SERVICE_PRESETS)) {
        throw new Error(
          `kickTestServices: '${key}' is no preset (${Object.keys(SERVICE_PRESETS).join(', ')}): give it { container: { image, port, url } }`,
        )
      }
    }
    const results = await Promise.allSettled(
      entries.map(([key, setup]) =>
        'container' in setup
          ? startContainer(setup.container)
          : startService(key as ServiceKind, setup),
      ),
    )
    const up = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) {
      // Don't leave the ones that did start running.
      await Promise.all(up.map((s) => s.stop()))
      throw failed.reason
    }
    entries.forEach(([key], i) => {
      const { url } = up[i]!
      project.provide(key, url)
      process.env[envName(key)] = url
    })
    // A reused service stays up for the next run; `stop()` leaves it.
    return async () => {
      await Promise.all(up.map((s) => s.stop()))
    }
  }
}
