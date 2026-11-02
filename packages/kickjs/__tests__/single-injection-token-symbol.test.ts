/**
 * `INJECTION_TOKEN` is a `unique symbol`, so every copy of its declaration is a
 * different type. When a package's bundled types carry their own copy, its tokens
 * stop matching `container.resolve()` while still working at runtime.
 *
 * A package gets a copy by exporting `createToken<T>()` with an inferred type and
 * no `InjectionToken` import in that file. Write the type on the export.
 *
 * Needs the sibling packages' `dist/`; CI builds everything before testing.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PACKAGES = resolve(import.meta.dirname, '../..')

describe('published types', () => {
  it('declare INJECTION_TOKEN only in @forinda/kickjs-di', () => {
    const copies = readdirSync(PACKAGES)
      .filter((name) => name !== 'di' && existsSync(join(PACKAGES, name, 'dist')))
      .flatMap((name) => {
        const dist = join(PACKAGES, name, 'dist')
        return readdirSync(dist, { recursive: true, encoding: 'utf8' })
          .filter((file) => file.endsWith('.d.mts'))
          .filter((file) =>
            readFileSync(join(dist, file), 'utf8').includes('declare const INJECTION_TOKEN'),
          )
          .map((file) => `${name}/dist/${file}`)
      })

    expect(copies).toEqual([])
  })
})
